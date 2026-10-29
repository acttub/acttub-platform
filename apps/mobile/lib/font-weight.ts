/**
 * fontWeight → 실제로 실린 Pretendard 패밀리 이름.
 *
 * 가변폰트 대신 굵기별 static 서브셋을 싣기 때문에(scripts/build-fonts.py) 굵기 선택이
 * "폰트 파일 선택"이 된다. React Native를 import하지 않아 node --test로 그대로 검증한다.
 */
export const PRETENDARD_REGULAR = 'Pretendard';
export const PRETENDARD_MEDIUM = 'Pretendard-Medium';
export const PRETENDARD_SEMIBOLD = 'Pretendard-SemiBold';
export const PRETENDARD_BOLD = 'Pretendard-Bold';

/**
 * 안드로이드는 같은 폰트 파일도 iOS 보다 두껍게 그려져 볼드가 너무 굵어 보였다(10/29) — 안드로이드에서만 한 단계 가볍게
 * 고른다: 700 이상은 SemiBold, 600 은 Medium. iOS 는 그대로다.
 */
export function fontFamilyForWeight(weight: unknown, platform?: string): string {
  const android = platform === 'android';
  if (weight === undefined || weight === null || weight === 'normal') return PRETENDARD_REGULAR;
  if (weight === 'bold') return android ? PRETENDARD_SEMIBOLD : PRETENDARD_BOLD;
  const numeric = typeof weight === 'number' ? weight : Number(weight);
  if (!Number.isFinite(numeric)) return PRETENDARD_REGULAR;
  if (numeric >= 700) return android ? PRETENDARD_SEMIBOLD : PRETENDARD_BOLD;
  if (numeric >= 600) return android ? PRETENDARD_MEDIUM : PRETENDARD_SEMIBOLD;
  return PRETENDARD_REGULAR;
}

/** 화면이 Pretendard 굵기를 이름으로 직접 고른 경우의 안드로이드 한 단계 가벼운 이름. 다른 폰트(아이콘 등)는 그대로. */
export function androidLighterFamily(family: string): string {
  if (family === PRETENDARD_BOLD) return PRETENDARD_SEMIBOLD;
  if (family === PRETENDARD_SEMIBOLD) return PRETENDARD_MEDIUM;
  return family;
}
