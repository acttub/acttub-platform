import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';
import { space, type } from '@/constants/tokens';
import { translate as t } from '@/lib/i18n';
import type { RecordMode } from '@/lib/record-modes';

/**
 * 셔터 아래 용도 줄 (SOMA-494, pen record-video.picker).
 *
 * <p>용도 이름을 가운데 한 줄로 두고 고른 것만 흰 글자, 나머지는 흐리게 그린다. 라벨을 눌러도 되고, 화면을 옆으로
 * 넘겨도 된다(넘기기는 촬영 화면이 받는다 — 여기는 그리기와 누르기만 맡는다).
 */
export function RecordModeSlider({
  modes,
  value,
  onChange,
  disabled,
}: {
  modes: readonly RecordMode[];
  value: RecordMode;
  onChange: (mode: RecordMode) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.row} accessibilityRole="tablist">
      {modes.map((mode) => {
        const on = mode === value;
        return (
          <Pressable
            key={mode}
            disabled={disabled}
            hitSlop={{ top: space[2], bottom: space[2], left: space[3], right: space[3] }}
            onPress={() => onChange(mode)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}>
            <Text style={[styles.label, on && styles.labelOn]} numberOfLines={1}>
              {t(`recordMode.${mode}`)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'center', gap: space[6] },
  label: { ...type.body2Bold, color: palette.onMediaSub, opacity: 0.7 },
  labelOn: { color: palette.onAccent, opacity: 1 },
});
