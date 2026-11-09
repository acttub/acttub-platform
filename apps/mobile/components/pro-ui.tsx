import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { PRO_STOPS } from '@/components/home-plan-badge';
import { BandGradient } from '@/components/ui/band-gradient';
import { DialogButtons, DialogCard, DialogModal } from '@/components/ui/dialog';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { translate as t } from '@/lib/i18n';

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
 */
export function CoachingLimitSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const router = useRouter();
  return (
    <DialogModal visible={visible} onRequestClose={onClose} onBackdropPress={onClose}>
      <DialogCard title={t('pro.coachingLimitTitle')} message={t('pro.coachingLimitBody')}>
        <DialogButtons
          cancelLabel={t('pro.coachingLimitLater')}
          onCancel={onClose}
          confirmLabel={t('pro.explore')}
          onConfirm={() => {
            onClose();
            router.push({ pathname: '/pro', params: { from: 'coaching' } });
          }}
        />
      </DialogCard>
    </DialogModal>
  );
}

const styles = StyleSheet.create({
  badge: { alignSelf: 'flex-start', height: 28, flexDirection: 'row', alignItems: 'center', gap: space[1], paddingHorizontal: space[3], borderRadius: radius.full, overflow: 'hidden' },
  badgeText: { ...type.micro, color: palette.onAccent },
});
