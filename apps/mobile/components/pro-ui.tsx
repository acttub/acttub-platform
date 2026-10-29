import { useRouter } from 'expo-router';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { DialogButtons, DialogCard } from '@/components/ui/dialog';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { translate as t } from '@/lib/i18n';

/** PRO 배지 — `text` 알약 · micro `on-accent`. */
export function ProBadge() {
  return (
    <View style={styles.badge}>
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
    <Modal transparent visible={visible} animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.full} onPress={(e) => e.stopPropagation()}>
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
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  badge: { alignSelf: 'flex-start', backgroundColor: palette.text, borderRadius: radius.full, paddingHorizontal: space[2], paddingVertical: 2 },
  badgeText: { ...type.micro, color: palette.onAccent },
  backdrop: { flex: 1, backgroundColor: palette.scrim, alignItems: 'center', justifyContent: 'center', padding: space.gutter },
  full: { width: '100%', alignItems: 'center' },
});
