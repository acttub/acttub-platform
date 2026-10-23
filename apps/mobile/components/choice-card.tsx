import Feather from '@expo/vector-icons/Feather';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';

/**
 * 고르는 카드(pen 「선택 규칙」). 기본은 아무것도 고르지 않은 상태이고, 누르면 고른 표시(옅은 파랑 바탕·파란 테두리·체크)가
 * 되며 아래 「다음」을 눌러야 넘어간다. 누르면 바로 넘어가는 줄이 아니다.
 */
export function ChoiceCard({
  title,
  sub,
  selected,
  disabled,
  phLabel,
  onPress,
}: {
  title: string;
  sub?: string;
  selected: boolean;
  disabled?: boolean;
  phLabel?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityLabel={title}
      accessibilityState={{ selected, disabled: !!disabled }}
      ph-label={phLabel}
      style={({ pressed }) => [styles.card, selected && styles.cardOn, pressed && !selected && styles.pressed]}>
      <View style={styles.body}>
        <Text style={[styles.title, selected && styles.titleOn]}>{title}</Text>
        {sub ? <Text style={styles.sub}>{sub}</Text> : null}
      </View>
      {selected ? <Feather name="check" size={22} color={palette.blue} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: palette.border,
    backgroundColor: palette.bg,
  },
  cardOn: { borderColor: palette.blue, backgroundColor: palette.blueSoft },
  pressed: { backgroundColor: palette.bgSoft },
  body: { flex: 1, minWidth: 0, gap: 5 },
  title: { fontSize: 17, fontWeight: '700', lineHeight: 23, color: palette.text },
  titleOn: { color: palette.blueDeep },
  sub: { fontSize: 14, fontWeight: '500', lineHeight: 21, color: palette.textFaint },
});
