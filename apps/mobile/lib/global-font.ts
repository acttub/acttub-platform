import { Platform, type TextStyle } from 'react-native';

import { fontFamilyForWeight, PRETENDARD_REGULAR } from '@/lib/font-weight';

/**
 * 앱 전역 기본 폰트를 Pretendard로 강제한다.
 * iOS(SF)·Android(Roboto)의 글자체/두께 렌더 차이로 디자인이 달라 보이는 문제를 없앤다.
 *
 * 실제로 덧씌우는 곳은 patches/react-native+*.patch 가 고친 RN 의 Text·TextInput 이다. 둘은 펼친 스타일을
 * 여기 등록한 fontStyleFor 에 넘기고 돌려받은 스타일을 뒤에 붙인다. RN 0.81 의 Text 는 일반 함수라 예전처럼
 * Text.render 를 바꿔치기할 수 없었고(그 패치는 아무 일도 안 했다), RN 안에서 고쳐야 Animated.Text 처럼
 * Text 모듈을 직접 가져다 쓰는 곳까지 닿는다.
 *
 * 왜 가변폰트를 버렸나
 *   전엔 PretendardVariable.ttf 하나만 깔고 fontWeight로 두께를 골랐는데, RN은 가변폰트의
 *   weight 축을 지정할 수 없다. iOS는 어떻게든 굵게 그려주지만 안드로이드는 fontWeight가
 *   무시되거나 가짜 볼드가 돼 "볼드가 안 먹는" 상태였다.
 *   → 굵기별 static 서브셋(scripts/build-fonts.py)을 싣고, fontWeight를 폰트 파일 선택으로 바꾼다.
 *
 * 중첩 Text 는 패밀리도 굵기도 없으면 부모 폰트를 그대로 물려받는다(RN 패치가 이때는 부르지 않는다).
 */
export function fontStyleFor(style: TextStyle | null | undefined): TextStyle | null {
  const android = Platform.OS === 'android';
  const family = style?.fontFamily;
  // 안드로이드는 글자 위아래에 폰트 여백을 더해 같은 글자도 iOS 보다 상자가 높다. Pretendard 글자만 빼서 iOS 와 높이를 맞춘다.
  const padding = android && style?.includeFontPadding == null ? { includeFontPadding: false } : null;
  // 패밀리를 직접 지정한 건 그대로 둔다(아이콘 폰트·이름으로 고른 Pretendard 굵기). 안드로이드 Pretendard 는 여백만 맞춘다.
  if (family) {
    if (!android || !family.startsWith(PRETENDARD_REGULAR)) return null;
    return padding;
  }
  return {
    fontFamily: fontFamilyForWeight(style?.fontWeight, Platform.OS),
    // 실제 굵은 폰트를 싣고 있으므로 가짜 볼드를 덧씌우지 않게 굵기는 중립으로 되돌린다.
    fontWeight: 'normal',
    ...padding,
  };
}

(globalThis as { __fontStyleFor?: typeof fontStyleFor }).__fontStyleFor = fontStyleFor;
