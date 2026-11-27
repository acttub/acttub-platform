import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { NavIconButton } from '@/components/ui/nav-header';
import { palette } from '@/constants/palette';
import { radius } from '@/constants/tokens';
import { useUnreadNotifications } from '@/hooks/use-unread-notifications';
import { translate as t } from '@/lib/i18n';

/**
 * 머리 오른쪽 알림 종(예전 홈 종, SOMA-1120에서 리딩·프로필 탭 머리로 옮김). 안 읽은 알림 묶음이 있으면 빨간 점을 단다
 * (challenge.notification). 누르면 알림함이다.
 */
export function NotificationBell({ phLabel }: { phLabel: string }) {
  const router = useRouter();
  const unread = useUnreadNotifications();
  return (
    <View>
      <NavIconButton
        icon="bell"
        label={unread.count > 0 ? t('home.bellUnreadA11y') : t('home.bellA11y')}
        phLabel={phLabel}
        onPress={() => router.push('/notifications')}
      />
      {unread.count > 0 && <View pointerEvents="none" style={styles.dot} testID="bell-unread-dot" />}
    </View>
  );
}

const styles = StyleSheet.create({
  dot: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 8,
    height: 8,
    borderRadius: radius.full,
    backgroundColor: palette.danger,
    borderWidth: 1.5,
    borderColor: palette.bg,
  },
});
