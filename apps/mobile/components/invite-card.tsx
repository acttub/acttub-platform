import Feather from '@expo/vector-icons/Feather';
import Constants from 'expo-constants';
import { useEffect, useState } from 'react';
import { Share, StyleSheet, Text, View } from 'react-native';

import { Button, TextButton } from '@/components/ui/buttons';
import { TextField } from '@/components/ui/text-field';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { useFocusLoad } from '@/hooks/use-focus-load';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatKoreanDate } from '@/lib/format';
import { translate as t } from '@/lib/i18n';
import {
  cleanInviteCode,
  inviteShareMessage,
  isInviteCode,
  newRewardsSinceSeen,
  redeemFailReason,
  takePendingInviteCode,
  type InviteMe,
  type RedeemFailReason,
} from '@/lib/invite';

/**
 * 친구 초대(SOMA-865, account.invite). 서버가 기능을 닫았거나(404) 상태를 못 읽으면 아무것도 그리지 않는다 — 꺼진 서버에서는
 * 화면이 예전과 같다. 팝업·바텀시트 없이 칸 안에서 끝나고, 처리 중에는 스피너 대신 짧은 문구를 보인다.
 */

type ShareFrom = 'profile' | 'reading_done';

const FAIL_COPY: Record<RedeemFailReason, string> = {
  not_found: 'invite.failNotFound',
  own_code: 'invite.failOwnCode',
  already: 'invite.failAlready',
  window_closed: 'invite.failWindowClosed',
  rate_limited: 'invite.failRateLimited',
  network: 'invite.failNetwork',
  unknown: 'invite.failUnknown',
};

/** OS 공유 시트로 스토어 주소·코드·보상 조건을 보낸다. 공유 결과만 남기고 코드는 계측에 싣지 않는다. */
async function shareInvite(code: string, from: ShareFrom): Promise<void> {
  const message = inviteShareMessage({
    code,
    intro: t('invite.shareIntro'),
    codeLine: t('invite.shareCode', { code }),
    reward: t('invite.shareReward'),
    androidPackage: Constants.expoConfig?.android?.package,
    iosAppStoreUrl: process.env.EXPO_PUBLIC_IOS_APP_STORE_URL ?? '',
  });
  try {
    const result = await Share.share({ message });
    logEvent('invite_share', { from, result: result.action === Share.sharedAction ? 'shared' : 'dismissed' });
  } catch {
    logEvent('invite_share', { from, result: 'failed' });
  }
}

/** 내 초대 상태. 어떤 실패(404 기능 꺼짐 포함)도 거절된 약속으로 돌려 부르는 쪽이 칸을 숨기게 한다. */
function loadInviteMe(): Promise<InviteMe> {
  return Promise.resolve()
    .then(() => api.inviteMe())
    .then((me) => {
      if (!me || typeof me.code !== 'string') throw new Error('invite_unavailable');
      return me;
    });
}

/** 보상 수가 늘었으면 지급 이벤트를 남긴다(받은 사람·초대한 사람 모두). */
function logNewRewards(userId: string | undefined, me: InviteMe): void {
  if (!userId) return;
  void newRewardsSinceSeen(userId, me.reward_count).then((count) => {
    if (count > 0) logEvent('invite_reward_granted', { count });
  });
}

/** 프로필 탭의 「친구 초대」 칸 — 보상 조건 한 줄, 내 코드, [친구 초대하기], 가입 7일 안이면 「초대 코드 입력」. */
export function InviteCard() {
  const { user } = useAuth();
  const [me, setMe] = useState<InviteMe | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<RedeemFailReason | null>(null);

  useFocusLoad((alive) => {
    void loadInviteMe()
      .then(async (next) => {
        if (!alive()) return;
        setMe(next);
        logNewRewards(user?.id, next);
        // 딥링크로 받은 코드가 있으면 넣기 칸에 채워 둔다(넣기는 배우가 누른다).
        if (next.can_redeem) {
          const pending = await takePendingInviteCode();
          if (pending && alive()) setCode(pending);
        }
      })
      .catch(() => alive() && setMe(null));
  }, [user?.id]);

  if (!me) return null;

  const submit = async () => {
    if (!isInviteCode(code) || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const next = await api.redeemInviteCode(code);
      setMe(next);
      logEvent('invite_redeem_success');
    } catch (e) {
      const reason = redeemFailReason(e);
      setFailure(reason);
      logEvent('invite_redeem_fail', { reason });
    } finally {
      setBusy(false);
    }
  };

  const status = me.rewarded ? t('invite.rewarded') : me.redeemed ? t('invite.redeemed') : null;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>{t('invite.title')}</Text>
        <Text style={styles.reward}>{t('invite.reward')}</Text>
        <Text style={styles.code} selectable>
          {t('invite.myCode', { code: me.code })}
        </Text>
      </View>
      <Button
        size="md"
        label={t('invite.share')}
        icon={<Feather name="user-plus" size={16} color={palette.onAccent} />}
        phLabel="invite_share_profile"
        onPress={() => void shareInvite(me.code, 'profile')}
      />
      {status && <Text style={styles.status}>{status}</Text>}
      {me.can_redeem && (
        <View style={styles.redeem}>
          <TextField
            label={t('invite.redeemLabel')}
            placeholder={t('invite.redeemPlaceholder')}
            value={code}
            onChangeText={(text) => {
              setCode(cleanInviteCode(text));
              setFailure(null);
            }}
            charset="off"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={12}
            editable={!busy}
            returnKeyType="done"
            onSubmitEditing={() => void submit()}
            error={failure ? t(FAIL_COPY[failure]) : null}
          />
          <View style={styles.redeemRow}>
            {me.redeem_until && (
              <Text style={styles.until}>
                {t('invite.redeemUntil', { date: formatKoreanDate(me.redeem_until, { month: 'long', day: 'numeric' }) })}
              </Text>
            )}
            <Button
              size="sm"
              label={t('invite.redeemSubmit')}
              loading={busy}
              loadingLabel={t('invite.redeemChecking')}
              disabled={!isInviteCode(code)}
              phLabel="invite_redeem_submit"
              onPress={() => void submit()}
            />
          </View>
        </View>
      )}
    </View>
  );
}

/** 리딩 끝 화면의 「친구 초대」 줄 — 보상 조건 한 줄과 [친구 초대하기]. */
export function InviteShareRow() {
  const [me, setMe] = useState<InviteMe | null>(null);

  useEffect(() => {
    let alive = true;
    loadInviteMe()
      .then((next) => alive && setMe(next))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  if (!me) return null;
  return (
    <View style={styles.row}>
      <Text style={styles.reward}>{t('invite.reward')}</Text>
      <TextButton
        tone="accent"
        label={t('invite.share')}
        icon={<Feather name="user-plus" size={16} color={palette.blueDeep} />}
        phLabel="invite_share_reading_done"
        onPress={() => void shareInvite(me.code, 'reading_done')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: space[3],
    padding: space[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.bg,
  },
  head: { gap: space[1] },
  title: { ...type.body1Bold, color: palette.text },
  reward: { ...type.body2, color: palette.textSub },
  code: { ...type.captionBold, color: palette.textMeta },
  status: { ...type.caption, color: palette.textSub },
  redeem: { gap: space[2] },
  redeemRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: space[2] },
  until: { flex: 1, ...type.caption, color: palette.textMeta },
  row: { alignItems: 'center', gap: space[1] },
});
