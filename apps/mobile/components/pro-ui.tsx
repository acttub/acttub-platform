import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { PRO_STOPS } from '@/components/home-plan-badge';
import { BandGradient } from '@/components/ui/band-gradient';
import { Button } from '@/components/ui/buttons';
import { DialogButtons, DialogCard, DialogModal } from '@/components/ui/dialog';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { confirmReward, rewardedUnitFor } from '@/lib/ads';
import { nonPersonalizedAdsOnly } from '@/lib/ads-native';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { showRewarded } from '@/lib/full-screen-ad';
import { translate as t } from '@/lib/i18n';
import { newRequestId } from '@/lib/request-id';

const API_URL = process.env.EXPO_PUBLIC_API_URL;
/** 확인창이 사라지는 시간(Modal fade). 다 사라진 뒤에 광고를 띄운다 — iOS 는 떠 있는 Modal 위에 광고 화면을 올리지 못한다. */
const DIALOG_FADE_MS = 350;

/** PRO 배지 — 디자인 시스템 pen 「PlanBadge/Pro」. 높이 28 알약, 그라데이션 + 왕관 14, micro `on-accent`. */
export function ProBadge() {
  return (
    <View style={styles.badge}>
      <BandGradient stops={PRO_STOPS} horizontal bands={16} />
      <MaterialCommunityIcons name="crown-outline" size={14} color={palette.onAccent} />
      <Text style={styles.badgeText}>{t('pro.badge')}</Text>
    </View>
  );
}

/**
 * 「오늘 무료 코칭 3회를 다 썼어요」 확인창. 서버가 429 free_daily_coaching_limit 을 줄 때만 뜬다(무료 한도 플래그가 꺼져 있으면
 * 서버가 이 코드를 보내지 않는다). [Pro 알아보기]는 코칭 한도에서 온 Pro 안내로, [내일 할게요]·바깥은 닫는다.
 *
 * onRewarded 를 주면 서버가 보상 가능이라고 할 때만 Pro 안내 아래에 「광고 보고 1회 더」가 보인다(SOMA-1067). 광고를 끝까지 보고
 * 서버 지급이 확인되면 onRewarded 를 부른다 — 부르는 화면이 코칭 시작을 다시 한다.
 */
export function CoachingLimitSheet({
  visible,
  onClose,
  onRewarded,
}: {
  visible: boolean;
  onClose: () => void;
  onRewarded?: () => void;
}) {
  const router = useRouter();
  const reward = useRewardedCoaching(visible, onRewarded);
  const busy = reward.phase === 'loading' || reward.phase === 'confirming';
  return (
    // 광고가 화면에 있는 동안만 확인창을 내린다. 광고가 닫히면 같은 상태(「확인하는 중…」)로 다시 보인다.
    <DialogModal visible={visible && reward.phase !== 'watching'} onRequestClose={onClose} onBackdropPress={busy ? undefined : onClose}>
      <DialogCard title={t('pro.coachingLimitTitle')} message={t('pro.coachingLimitBody')}>
        <DialogButtons
          cancelLabel={t('pro.coachingLimitLater')}
          onCancel={onClose}
          confirmLabel={t('pro.explore')}
          confirmDisabled={busy}
          onConfirm={() => {
            onClose();
            router.push({ pathname: '/pro', params: { from: 'coaching' } });
          }}
        />
        {reward.phase !== 'hidden' ? (
          <View style={styles.reward}>
            <Button
              variant="secondary"
              label={t('pro.rewardMore')}
              phLabel="coaching_reward_more"
              loading={busy}
              loadingLabel={reward.phase === 'confirming' ? t('pro.rewardConfirming') : t('pro.rewardLoading')}
              onPress={() => void reward.start()}
            />
            {reward.note ? <Text style={styles.rewardNote}>{reward.note}</Text> : null}
          </View>
        ) : null}
      </DialogCard>
    </DialogModal>
  );
}

/** hidden: 버튼 없음 · ready: 버튼 · loading: 광고 불러오는 중 · watching: 광고가 화면에 있음 · confirming: 서버 지급 확인 중. */
type RewardPhase = 'hidden' | 'ready' | 'loading' | 'watching' | 'confirming';

/**
 * 「광고 보고 1회 더」의 상태(SOMA-1067). 확인창이 열릴 때 서버에 버튼을 보일지 묻고(운영 광고 단위가 없거나 웹이면 묻지 않는다),
 * 누르면 1회용 요청 id 를 실어 보상형 광고를 띄우고, 다 보면 서버 지급을 약 10초까지 묻는다.
 */
function useRewardedCoaching(open: boolean, onRewarded?: () => void) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const unit = Platform.OS === 'web' ? null : rewardedUnitFor(Platform.OS === 'ios' ? 'ios' : 'android', API_URL);
  const wanted = Boolean(onRewarded);
  const [phase, setPhase] = useState<RewardPhase>('hidden');
  const [note, setNote] = useState<string | null>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const onRewardedRef = useRef(onRewarded);
  onRewardedRef.current = onRewarded;

  useEffect(() => {
    setNote(null);
    setPhase('hidden');
    if (!open || !wanted || !unit || !userId) return;
    let alive = true;
    // 옛 서버·꺼진 스위치·대상 아님이면 버튼이 없다. 묻기가 실패해도 확인창은 그대로다.
    Promise.resolve()
      .then(() => api.coachingRewardStatus())
      .then((status) => {
        if (!alive || !status?.available) return;
        setPhase('ready');
        logEvent('coaching_reward_shown');
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [open, wanted, unit, userId]);

  const start = useCallback(async () => {
    if (!unit || !userId || phase !== 'ready') return;
    logEvent('coaching_reward_click');
    setNote(null);
    setPhase('loading');
    const requestId = newRequestId();
    const result = await showRewarded(unit, nonPersonalizedAdsOnly(), { userId, customData: requestId }, undefined, {
      beforeShow: () => {
        setPhase('watching');
        return new Promise((resolve) => setTimeout(resolve, DIALOG_FADE_MS));
      },
      onOpened: () => logEvent('coaching_reward_ad_shown'),
    });
    if (!openRef.current) return;
    if (result !== 'earned') {
      logEvent('coaching_reward_failed', { reason: result === 'closed' ? 'closed' : 'no_ad' });
      setNote(t(result === 'closed' ? 'pro.rewardNotFinished' : 'pro.rewardNoAd'));
      setPhase('ready');
      return;
    }
    setPhase('confirming');
    const granted = await confirmReward(() => api.coachingRewardGranted(requestId).then((answer) => answer.granted));
    if (!openRef.current) return;
    if (granted) {
      logEvent('coaching_reward_confirmed');
      setPhase('hidden');
      onRewardedRef.current?.();
      return;
    }
    logEvent('coaching_reward_failed', { reason: 'unconfirmed' });
    setNote(t('pro.rewardUnconfirmed'));
    setPhase('ready');
  }, [unit, userId, phase]);

  return { phase, note, start };
}

const styles = StyleSheet.create({
  badge: { alignSelf: 'flex-start', height: 28, flexDirection: 'row', alignItems: 'center', gap: space[1], paddingHorizontal: space[3], borderRadius: radius.full, overflow: 'hidden' },
  badgeText: { ...type.micro, color: palette.onAccent },
  reward: { gap: space[2], paddingTop: space[2] },
  rewardNote: { ...type.body2, color: palette.textSub, textAlign: 'center' },
});
