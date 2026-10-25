import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

/**
 * 사진이 없는 사람의 기본 얼굴(pen 「P/DefaultAvatar/*」) — 색 바탕에 흰 머리 동그라미와 어깨 반달.
 * pen 원본은 84×84(모서리 32)이고 머리 32(왼 26·위 17), 어깨 62×54(왼 11·위 55)다. 다른 크기는 같은 비율로 줄인다.
 * 바탕색은 여덟 가지 중 `seed`(사용자 id 등)로 늘 같은 하나를 고른다. 탈퇴한 사람은 회색(`DEFAULT_AVATAR_GONE`)을 넘긴다.
 */
export const DEFAULT_AVATAR_COLORS = [
  '#B9CADB', // Sky
  '#F3C4AE', // Peach
  '#A6D6C5', // Mint
  '#C6BCE6', // Lavender
  '#EED79A', // Lemon
  '#EDB8C5', // Rose
  '#9CCFE0', // Aqua
  '#C2D2A2', // Sage
] as const;

/** pen 기본 얼굴 Mint — seed 가 없을 때 쓰는 색. */
export const DEFAULT_AVATAR_MINT = DEFAULT_AVATAR_COLORS[2];

/** 탈퇴한 사용자 얼굴 바탕(pen S18.4 「탈퇴한 사용자」). */
export const DEFAULT_AVATAR_GONE = '#C9CED6';

/** seed 로 여덟 색 중 하나를 늘 같게 고른다. seed 가 비면 Mint. */
export function defaultAvatarColor(seed?: string | null): string {
  if (!seed) return DEFAULT_AVATAR_MINT;
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return DEFAULT_AVATAR_COLORS[Math.abs(hash) % DEFAULT_AVATAR_COLORS.length];
}

export function DefaultAvatar({
  size = 84,
  radius,
  seed,
  color,
  style,
}: {
  size?: number;
  /** 모서리. 빼면 pen 비율(84 → 32)을 따른다. 동그라미는 size / 2 를 넘긴다. */
  radius?: number;
  seed?: string | null;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const k = size / 84;
  const head = 32 * k;
  const shoulder = 62 * k;
  return (
    <View
      testID="default-avatar"
      style={[
        styles.box,
        { width: size, height: size, borderRadius: radius ?? 32 * k, backgroundColor: color ?? defaultAvatarColor(seed) },
        style,
      ]}>
      <View style={[styles.white, { left: 26 * k, top: 17 * k, width: head, height: head, borderRadius: head / 2 }]} />
      {/* 어깨는 62×54 타원 — 동그라미를 세로로 눌러 만든다. */}
      <View
        style={[
          styles.white,
          {
            left: 11 * k,
            top: 55 * k - (shoulder - 54 * k) / 2,
            width: shoulder,
            height: shoulder,
            borderRadius: shoulder / 2,
            transform: [{ scaleY: 54 / 62 }],
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden' },
  white: { position: 'absolute', backgroundColor: '#FFFFFF' },
});
