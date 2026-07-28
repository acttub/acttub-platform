import React from 'react';
import { Text, TextInput } from 'react-native';

/**
 * 앱 전역 기본 폰트를 Pretendard(가변폰트)로 강제한다.
 * iOS(SF)·Android(Roboto)의 글자체/두께 렌더 차이로 디자인이 달라 보이는 문제를 없앤다.
 *
 * 방식: RN Text/TextInput의 render를 감싸 fontFamily를 base로 주입.
 * - defaultProps.style은 style prop이 있는 컴포넌트엔 안 먹혀서 render 패치를 쓴다.
 * - Pretendard를 '먼저' 깔고 원래 style을 뒤에 둬서, 아이콘 폰트(MaterialIcons가 지정한
 *   fontFamily) 등 개별 지정이 있으면 그게 이긴다 → 아이콘은 그대로 유지.
 * - 두께는 각 스타일의 fontWeight가 가변폰트에서 그대로 선택된다.
 */
const FONT_FAMILY = 'Pretendard';

/* eslint-disable @typescript-eslint/no-explicit-any */
function applyGlobalFont(Component: any) {
  if (!Component || Component.__globalFontApplied || typeof Component.render !== 'function') return;
  const original = Component.render;
  Component.__globalFontApplied = true;
  Component.render = function patchedRender(...args: any[]) {
    const element = original.apply(this, args);
    if (!element) return element;
    return React.cloneElement(element, {
      style: [{ fontFamily: FONT_FAMILY }, element.props?.style],
    });
  };
}

applyGlobalFont(Text);
applyGlobalFont(TextInput);
