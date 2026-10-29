import { StatusBar } from 'expo-status-bar';
import { Image, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BandGradient } from '@/components/ui/band-gradient';
import { motion } from '@/constants/motion';
import { translate as t } from '@/lib/i18n';

// pen S1.1 진입 관문 · 스플래시 B안(Z6D118). 네이티브 스플래시는 단색 한 장이라 그라데이션·구름·태그라인을 못 그려서,
// 네이티브는 그라데이션 첫 색만 깔고 이 화면이 앱 준비(홈 대기 포함, lib/launch-splash.ts)가 끝날 때까지 덮는다.
const STOPS = [
  [0, '#7CCBFF'],
  [0.5, '#3A97F5'],
  [1, '#1257D6'],
] as const;

// pen 은 390pt 폭 기준이다. 구름·그림자 그림은 pen에서 blur 여백까지 포함해 내보낸 것이라 그만큼(PAD) 밖으로 민다.
const PEN_WIDTH = 390;
const CLOUD_PAD = 7 / 3;
const SHADOW_PAD = 12;

export function LaunchSplashScreen({ onShown }: { onShown: () => void }) {
  const insets = useSafeAreaInsets();
  const s = useWindowDimensions().width / PEN_WIDTH;
  // pen 좌표(x, 아래 끝에서 넘친 길이, 폭, 높이)를 화면 폭에 맞춰 늘린다.
  const cloud = (x: number, overflow: number, w: number, h: number) => ({
    position: 'absolute' as const,
    left: (x - CLOUD_PAD) * s,
    bottom: -(overflow + CLOUD_PAD) * s,
    width: (w + CLOUD_PAD * 2) * s,
    height: (h + CLOUD_PAD * 2) * s,
  });
  return (
    <Animated.View exiting={FadeOut.duration(motion.standard)} testID="launch-splash" style={StyleSheet.absoluteFill} onLayout={onShown}>
      <StatusBar style="light" />
      <BandGradient stops={STOPS} bands={64} />
      <Image source={require('@/assets/images/splash-cloud-1.png')} style={cloud(-110, 118, 290, 240)} />
      <Image source={require('@/assets/images/splash-cloud-2.png')} style={cloud(110, 131, 250, 200)} />
      <View style={[styles.body, { paddingTop: insets.top, paddingBottom: insets.bottom + 40 }]}>
        <View style={styles.stage}>
          <Image source={require('@/assets/images/splash-shadow.png')} style={styles.shadow} />
          <Image source={require('@/assets/images/splash-mascot.png')} style={styles.mascot} resizeMode="contain" />
        </View>
        <View style={styles.brand}>
          <Image
            source={require('@/assets/images/splash-wordmark.png')}
            style={styles.wordmark}
            resizeMode="contain"
            accessibilityLabel="Acttub"
          />
          <View style={styles.pill}>
            <Text style={styles.tagline}>{t('launch.tagline')}</Text>
          </View>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 22 },
  stage: { width: 300, height: 290 },
  shadow: { position: 'absolute', left: 90 - SHADOW_PAD, top: 244 - SHADOW_PAD, width: 140 + SHADOW_PAD * 2, height: 18 + SHADOW_PAD * 2 },
  mascot: { position: 'absolute', left: 10, top: 0, width: 280, height: 280 },
  brand: { alignItems: 'center', gap: 14 },
  wordmark: { width: 276, height: 101 },
  pill: {
    backgroundColor: '#FFFFFF2E',
    borderColor: '#FFFFFF66',
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 9,
    paddingHorizontal: 20,
    boxShadow: '0px 8px 20px #0A3E9E33',
  },
  tagline: {
    color: '#FFFFFF',
    fontSize: 17,
    lineHeight: 25,
    fontWeight: '600',
    letterSpacing: -0.2,
    textShadowColor: '#0A3E9E40',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
});
