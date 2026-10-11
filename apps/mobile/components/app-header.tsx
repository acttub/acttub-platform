import type { NativeStackHeaderProps } from '@react-navigation/native-stack';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';

/**
 * iOS 스택 화면의 헤더 — 설정 화면처럼 꺾쇠 옆에 제목을 붙인다(SOMA-638). iOS 26 의 네이티브 헤더는 왼쪽·오른쪽
 * 버튼마다 유리 배경을 씌워 꺾쇠와 아이콘이 뭉개져 보이는데, 지금 rn-screens 는 그 배경을 끄는 설정을 네이티브에서
 * 지원하지 않아 헤더를 직접 그린다. 화면이 준 headerLeft·headerRight·headerShadowVisible 은 그대로 따른다.
 */
export function AppHeader({ options, back }: NativeStackHeaderProps) {
  const insets = useSafeAreaInsets();
  const left = options.headerLeft?.({ canGoBack: !!back, tintColor: palette.text });
  const right = options.headerRight?.({ canGoBack: !!back, tintColor: palette.text });
  const title = typeof options.title === 'string' ? options.title : '';
  return (
    <View style={[styles.bar, { paddingTop: insets.top }, options.headerShadowVisible !== false && styles.line]}>
      <View style={styles.row}>
        {left}
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {right ? <View style={styles.right}>{right}</View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { backgroundColor: palette.card },
  line: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 52, paddingHorizontal: 16 },
  title: { flex: 1, fontSize: 19, fontWeight: '800', color: palette.text },
  right: { flexDirection: 'row', alignItems: 'center' },
});
