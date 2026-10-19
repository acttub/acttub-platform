import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';

import { palette } from '@/constants/palette';

/**
 * pen 「알림이 꺼져 있어요」「가입할 수 없어요」(SOMA-748) — 가운데 마스코트 · 제목 · 설명, 아래 버튼 1~2개.
 * `hint`는 파란 안내(「X」를 누르세요), `body`는 회색 설명이다.
 */
export function AccountStatus({
  mascot,
  title,
  body,
  hint,
  actions,
}: {
  mascot: ImageSourcePropType;
  title: string;
  body?: string;
  hint?: string;
  actions: ReactNode;
}) {
  return (
    <View style={styles.wrap}>
      <View style={styles.center}>
        <Image source={mascot} style={styles.mascot} contentFit="contain" accessibilityIgnoresInvertColors />
        <Text style={styles.title}>{title}</Text>
        {body ? <Text style={styles.body}>{body}</Text> : null}
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <View style={styles.actions}>{actions}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32, paddingBottom: 40 },
  mascot: { width: 110, height: 122 },
  title: { fontSize: 24, fontWeight: '800', lineHeight: 34, color: palette.text, textAlign: 'center' },
  body: { fontSize: 16, fontWeight: '500', lineHeight: 26, color: palette.textMuted, textAlign: 'center' },
  hint: { fontSize: 15, fontWeight: '700', lineHeight: 22, color: palette.blueDeep, textAlign: 'center' },
  actions: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 10, gap: 10 },
});
