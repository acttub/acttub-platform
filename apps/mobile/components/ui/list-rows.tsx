import { Switch } from 'react-native';

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
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      trackColor={{ true: palette.blue, false: palette.textDisabled }}
      thumbColor={palette.onAccent}
      ios_backgroundColor={palette.textDisabled}
      accessibilityLabel={accessibilityLabel}
    />
  );
}
