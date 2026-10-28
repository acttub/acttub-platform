// 10/27 디자인 개편(개편전 = dev) 모양 그대로(SOMA-923). 개편전 모양을 쓰기로 한 화면만 쓴다.
import type { NativeStackHeaderProps } from '@react-navigation/native-stack';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NavHeader } from '@/components/ds/ui/nav-header';
import { palette } from '@/constants/palette';

export { NavBackButton, NavHeader, NavIconButton } from '@/components/ds/ui/nav-header';

/**
 * iOS 스택 화면의 헤더(SOMA-638). iOS 26 의 네이티브 헤더는 왼쪽·오른쪽 버튼마다 유리 배경을 씌워 꺾쇠와 아이콘이
 * 뭉개져 보이는데, 지금 rn-screens 는 그 배경을 끄는 설정을 네이티브에서 지원하지 않아 헤더를 직접 그린다.
 * 화면이 준 headerLeft·headerRight 는 그대로 따른다. 모양은 pen NavHeader(SOMA-748) — 아래 줄은 그리지 않는다.
 */
export function AppHeader({ options, back }: NativeStackHeaderProps) {
  const insets = useSafeAreaInsets();
  const left = options.headerLeft?.({ canGoBack: !!back, tintColor: palette.text });
  const right = options.headerRight?.({ canGoBack: !!back, tintColor: palette.text });
  const title = typeof options.title === 'string' ? options.title : '';
  return (
    <View style={[styles.bar, { paddingTop: insets.top }]}>
      <NavHeader
        title={title}
        left={left}
        right={right ? <View style={styles.rightInner}>{right}</View> : null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { backgroundColor: palette.bg },
  rightInner: { flexDirection: 'row', alignItems: 'center', paddingRight: 8, gap: 16 },
});
