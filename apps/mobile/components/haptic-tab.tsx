import { BottomTabBarButtonProps } from '@react-navigation/bottom-tabs';
import { PlatformPressable } from '@react-navigation/elements';
import * as Haptics from 'expo-haptics';

export function HapticTab(props: BottomTabBarButtonProps) {
  return (
    <PlatformPressable
      {...props}
      // iOS는 탭 이름 글자가 없어서 라이브러리 기본(위쪽 붙임) 대신 아이콘을 탭바 세로 가운데에 둔다(SOMA-838). 안드로이드는 이름이 있어 기본 그대로.
      style={process.env.EXPO_OS === 'ios' ? [props.style, { justifyContent: 'center' }] : props.style}
      onPressIn={(ev) => {
        if (process.env.EXPO_OS === 'ios') {
          // Add a soft haptic feedback when pressing down on the tabs.
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        props.onPressIn?.(ev);
      }}
    />
  );
}
