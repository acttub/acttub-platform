import Feather from '@expo/vector-icons/Feather';
import type { NativeStackHeaderProps } from '@react-navigation/native-stack';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';

/**
 * pen 「NavHeader」(SOMA-748) — 높이 52, 왼쪽 꺾쇠 칸(44), 가운데 제목 17/700, 오른쪽 칸(44), 아래 줄 없음.
 * 기본 헤더(AppHeader)와 자체 헤더를 그리는 화면이 같이 쓴다. 제목은 양쪽 칸 폭과 상관없이 화면 가운데에 둔다.
 */
export function NavHeader({ title, left, right }: { title: string; left?: ReactNode; right?: ReactNode }) {
  return (
    <View style={styles.row}>
      <View style={styles.titleBox} pointerEvents="none">
        <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
      </View>
      <View style={styles.side}>{left}</View>
      <View style={[styles.side, styles.sideRight]}>{right}</View>
    </View>
  );
}

/** NavHeader 왼쪽 칸의 꺾쇠 버튼 — 자체 헤더를 그리는 화면용. */
export function NavBackButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={styles.back} accessibilityRole="button" accessibilityLabel={t('common.back')}>
      <Feather name="chevron-left" size={26} color={palette.text} />
    </Pressable>
  );
}

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
        left={left ? <View style={styles.back}>{left}</View> : null}
        right={right ? <View style={styles.rightInner}>{right}</View> : null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { backgroundColor: palette.bg },
  row: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8 },
  // 제목은 양쪽 칸 위에 깔리지 않게 좌우 96 을 비우고 가운데 정렬한다(C/DetailHeader 의 양쪽 칸 폭).
  titleBox: { position: 'absolute', top: 0, bottom: 0, left: 96, right: 96, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '700', color: palette.text, textAlign: 'center' },
  side: { minWidth: 44, height: 44, flexDirection: 'row', alignItems: 'center' },
  sideRight: { justifyContent: 'flex-end' },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  rightInner: { flexDirection: 'row', alignItems: 'center', paddingRight: 8, gap: 16 },
});
