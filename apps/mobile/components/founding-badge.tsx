import { StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { isFoundingNumber } from '@/lib/billing';
import { translate as t } from '@/lib/i18n';

/**
 * 이름 옆의 작은 「창립 멤버」 배지(SOMA-861). 새 디자인이 아니라 기존 토큰(알약 radius.full · micro 글자 · blueSoft/blueDeep)만 쓴다.
 * 번호가 1~100 이 아니면 아무것도 그리지 않는다.
 */
export function FoundingBadge({ number, onDark = false, inline = false }: { number?: number | null; onDark?: boolean; inline?: boolean }) {
  if (!isFoundingNumber(number)) return null;
  return (
    <View style={[styles.badge, inline && styles.badgeInline, onDark && styles.badgeDark]} accessible accessibilityLabel={t('pro.foundingMine', { number })}>
      <Text style={[styles.label, onDark && styles.labelDark]} numberOfLines={1}>
        {t('pro.foundingBadge')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignSelf: 'flex-start', paddingHorizontal: space[1.5], height: 20, justifyContent: 'center', borderRadius: radius.full, backgroundColor: palette.blueSoft },
  badgeInline: { alignSelf: 'center' },
  badgeDark: { backgroundColor: palette.onAccent },
  label: { ...type.micro, color: palette.blueDeep },
  labelDark: { color: palette.text },
});
