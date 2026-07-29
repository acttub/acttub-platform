import React from 'react';
import { StyleSheet, Text, TextInput, type TextStyle } from 'react-native';

import { fontFamilyForWeight } from '@/lib/font-weight';

/**
 * 앱 전역 기본 폰트를 Pretendard로 강제한다.
 * iOS(SF)·Android(Roboto)의 글자체/두께 렌더 차이로 디자인이 달라 보이는 문제를 없앤다.
 *
 * 왜 가변폰트를 버렸나
 *   전엔 PretendardVariable.ttf 하나만 깔고 fontWeight로 두께를 골랐는데, RN은 가변폰트의
 *   weight 축을 지정할 수 없다. iOS는 어떻게든 굵게 그려주지만 안드로이드는 fontWeight가
 *   무시되거나 가짜 볼드가 돼 "볼드가 안 먹는" 상태였다.
 *   → 굵기별 static 서브셋(scripts/build-fonts.py)을 싣고, fontWeight를 폰트 파일 선택으로 바꾼다.
 *
 * 주의: 굵기는 각 Text가 자기 스타일에 fontWeight를 가지고 있어야 결정된다.
 *       부모 Text의 굵기를 자식이 물려받던 동작에는 기대지 말 것.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
function applyGlobalFont(Component: any) {
  if (!Component || Component.__globalFontApplied || typeof Component.render !== 'function') return;
  const original = Component.render;
  Component.__globalFontApplied = true;
  Component.render = function patchedRender(...args: any[]) {
    const element = original.apply(this, args);
    if (!element) return element;
    const style = element.props?.style;
    const flattened = (StyleSheet.flatten(style) ?? {}) as TextStyle;
    // 아이콘 폰트(Feather 등)처럼 패밀리를 직접 지정한 건 건드리지 않는다.
    if (flattened.fontFamily) return element;
    return React.cloneElement(element, {
      style: [
        style,
        {
          fontFamily: fontFamilyForWeight(flattened.fontWeight),
          // 실제 굵은 폰트를 싣고 있으므로 가짜 볼드를 덧씌우지 않게 굵기는 중립으로 되돌린다.
          fontWeight: 'normal' as const,
        },
      ],
    });
  };
}

applyGlobalFont(Text);
applyGlobalFont(TextInput);
