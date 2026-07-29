/**
 * fontWeight → 실제로 실린 Pretendard 패밀리 이름.
 *
 * 가변폰트 대신 굵기별 static 서브셋을 싣기 때문에(scripts/build-fonts.py) 굵기 선택이
 * "폰트 파일 선택"이 된다. React Native를 import하지 않아 node --test로 그대로 검증한다.
 */
export const PRETENDARD_REGULAR = 'Pretendard';
export const PRETENDARD_SEMIBOLD = 'Pretendard-SemiBold';
export const PRETENDARD_BOLD = 'Pretendard-Bold';

export function fontFamilyForWeight(weight: unknown): string {
  if (weight === undefined || weight === null || weight === 'normal') return PRETENDARD_REGULAR;
  if (weight === 'bold') return PRETENDARD_BOLD;
  const numeric = typeof weight === 'number' ? weight : Number(weight);
  if (!Number.isFinite(numeric)) return PRETENDARD_REGULAR;
  if (numeric >= 700) return PRETENDARD_BOLD;
  if (numeric >= 600) return PRETENDARD_SEMIBOLD;
  return PRETENDARD_REGULAR;
}
