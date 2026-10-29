/**
 * fontWeight → 실제로 실린 Pretendard 패밀리 이름.
 *
 * 가변폰트 대신 굵기별 static 서브셋을 싣기 때문에(scripts/build-fonts.py) 굵기 선택이
 * "폰트 파일 선택"이 된다. React Native를 import하지 않아 node --test로 그대로 검증한다.
 */
export const PRETENDARD_REGULAR = 'Pretendard';
export const PRETENDARD_SEMIBOLD = 'Pretendard-SemiBold';
export const PRETENDARD_BOLD = 'Pretendard-Bold';

/** iOS·안드로이드 같은 규칙이다. 안드로이드만 한 단계 가볍게 그리던 것(10/29)은 뺐다. platform 은 부르는 쪽 호환으로만 받는다. */
export function fontFamilyForWeight(weight: unknown, _platform?: string): string {
  if (weight === undefined || weight === null || weight === 'normal') return PRETENDARD_REGULAR;
  if (weight === 'bold') return PRETENDARD_BOLD;
  const numeric = typeof weight === 'number' ? weight : Number(weight);
  if (!Number.isFinite(numeric)) return PRETENDARD_REGULAR;
  if (numeric >= 700) return PRETENDARD_BOLD;
  if (numeric >= 600) return PRETENDARD_SEMIBOLD;
  return PRETENDARD_REGULAR;
}
