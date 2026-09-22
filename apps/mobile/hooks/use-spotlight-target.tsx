import { useCallback, useEffect, useRef } from 'react';
import { type View } from 'react-native';

import { clearTargetRect, setTargetRect } from '@/lib/spotlight-targets';

/**
 * 가이드가 비출 요소에 붙여, 화면에서 차지한 자리를 재어 둔다 (SOMA-550).
 *
 * <p>쓰는 쪽은 두 줄이다 — 돌려받은 {@code ref} 와 {@code onLayout} 을 그 요소에 그대로 준다.
 *
 * <p>화면 기준이 아니라 <b>창(window) 기준</b>으로 잰다. 가이드는 탭바 위까지 덮는 별도 창이라,
 * 화면 안 좌표로 재면 탭바의 촬영 버튼이 엉뚱한 자리에 비친다.
 */
export function useSpotlightTarget(id: string) {
  const ref = useRef<View | null>(null);

  const onLayout = useCallback(() => {
    // 레이아웃이 끝난 뒤라야 창 기준 자리가 제대로 나온다.
    ref.current?.measureInWindow((x, y, width, height) => {
      if (!width || !height) return;
      setTargetRect(id, { x, y, width, height });
    });
  }, [id]);

  useEffect(() => () => clearTargetRect(id), [id]);

  return { ref, onLayout };
}
