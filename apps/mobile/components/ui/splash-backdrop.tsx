import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { translate as t } from '@/lib/i18n';

// pen S1.1 하늘 바탕 — 위 #7CCBFF · 가운데 #3A97F5 · 아래 #1257D6. 그라데이션 모듈이 없어 가는 띠를 겹쳐 그린다.
const STOPS = [
  { at: 0, rgb: [0x7c, 0xcb, 0xff] },
  { at: 0.5, rgb: [0x3a, 0x97, 0xf5] },
  { at: 1, rgb: [0x12, 0x57, 0xd6] },
];
const BANDS = 32;

function bandColor(index: number): string {
  const pos = index / (BANDS - 1);
  const upper = pos <= 0.5 ? 0 : 1;
  const a = STOPS[upper];
  const b = STOPS[upper + 1];
  const k = (pos - a.at) / (b.at - a.at);
  const [r, g, bl] = a.rgb.map((v, i) => Math.round(v + (b.rgb[i] - v) * k));
  return `rgb(${r},${g},${bl})`;
}

/**
 * 스플래시 · 업데이트 안내 뒤에 까는 하늘 배경(pen S1.1 · S2.1): 구름 둘, 액티, 워드마크, 알약 문구.
 * 맨 위에 올리는 것(다이얼로그)은 `children`으로 받는다.
 */
export function SplashBackdrop({ children }: { children?: React.ReactNode }) {
  return (
    <View style={styles.root}>
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {Array.from({ length: BANDS }, (_, i) => (
          <View key={i} style={{ flex: 1, backgroundColor: bandColor(i) }} />
        ))}
      </View>
      <View style={[styles.cloud, styles.cloudBig]} pointerEvents="none" />
      <View style={[styles.cloud, styles.cloudSmall]} pointerEvents="none" />
      <View style={styles.body}>
        <View style={styles.stage}>
          <View style={styles.shadow} />
          <Image source={require('@/assets/images/splash-mascot.png')} style={styles.mascot} contentFit="contain" accessibilityIgnoresInvertColors />
        </View>
        <View style={styles.brand}>
          <Image source={require('@/assets/images/splash-wordmark.png')} style={styles.wordmark} contentFit="contain" accessibilityIgnoresInvertColors />
          <View style={styles.pill}>
            <Text style={styles.tagline}>{t('splash.tagline')}</Text>
          </View>
        </View>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#3A97F5' },
  cloud: { position: 'absolute', backgroundColor: '#E4F1FF', borderRadius: 999 },
  cloudBig: { width: 290, height: 240, left: -90, bottom: -90, opacity: 0.9 },
  cloudSmall: { width: 250, height: 200, right: -70, bottom: -70, opacity: 0.9 },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 22, paddingBottom: 40 },
  stage: { width: 300, height: 290, alignItems: 'center', justifyContent: 'center' },
  shadow: { position: 'absolute', bottom: 6, width: 140, height: 18, borderRadius: 9, backgroundColor: '#0B4FB84D' },
  mascot: { width: 280, height: 280 },
  brand: { alignItems: 'center', gap: 14 },
  wordmark: { width: 276, height: 92 },
  pill: { paddingVertical: 9, paddingHorizontal: 20, borderRadius: 999, borderWidth: 1, borderColor: '#FFFFFF66', backgroundColor: '#FFFFFF2E' },
  tagline: { fontSize: 17, fontWeight: '600', color: '#FFFFFF' },
});
