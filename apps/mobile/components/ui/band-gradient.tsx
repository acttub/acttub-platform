import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

// 그라데이션 모듈(expo-linear-gradient·svg)이 앱에 없어서, 얇은 색 띠를 위에서 아래로 쌓아 pen의 세로 그라데이션을 그린다.
// stops: [위치(0~1), '#RRGGBB'] 목록. 띠가 촘촘해 108~250px 높이에서는 경계가 보이지 않는다.
type Stop = readonly [number, string];

const hex = (c: string) => {
  const h = c.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};

export function colorAt(stops: readonly Stop[], p: number): string {
  if (p <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [p1, c1] = stops[i];
    const [p0, c0] = stops[i - 1];
    if (p <= p1) {
      const k = p1 === p0 ? 0 : (p - p0) / (p1 - p0);
      const a = hex(c0);
      const b = hex(c1);
      const m = a.map((v, j) => Math.round(v + (b[j] - v) * k));
      return `rgb(${m[0]},${m[1]},${m[2]})`;
    }
  }
  return stops[stops.length - 1][1];
}

export function BandGradient({ stops, bands = 28, style }: { stops: readonly Stop[]; bands?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      {Array.from({ length: bands }, (_, i) => (
        <View key={i} style={{ flex: 1, backgroundColor: colorAt(stops, (i + 0.5) / bands) }} />
      ))}
    </View>
  );
}
