// 10/27 디자인 개편(개편전 = dev) 모양 그대로(SOMA-923). 개편전 모양을 쓰기로 한 화면만 쓴다.
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
