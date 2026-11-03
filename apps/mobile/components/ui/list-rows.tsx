import { StyleSheet, Switch, View } from 'react-native';

import { palette } from '@/constants/palette';

/** 앱 공통 스위치 — pen 「Switch/On」·「Switch/Off」: 켜짐 blue, 꺼짐 text-disabled. */
export function BlueSwitch({
  value,
  onValueChange,
  disabled,
  accessibilityLabel,
}: {
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <View style={styles.switchBox}>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ true: palette.blue, false: palette.textDisabled }}
        thumbColor={palette.onAccent}
        ios_backgroundColor={palette.textDisabled}
        accessibilityLabel={accessibilityLabel}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // iOS 26 스위치는 자기 자리 위쪽에 붙어 그려져 같은 줄 글자보다 위로 치우쳤다 — 높이를 준 칸 가운데에 둔다.
  switchBox: { height: 31, justifyContent: 'center' },
});
