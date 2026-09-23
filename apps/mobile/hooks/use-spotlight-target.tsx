import { useCallback, useEffect, useRef } from 'react';
import { type View } from 'react-native';

import { clearTargetRect, registerMeasure, setTargetRect } from '@/lib/spotlight-targets';

/**
 * 가이드가 비출 요소에 붙여, 화면에서 차지한 자리를 재어 둔다 (SOMA-550).
 *
 * <p>쓰는 쪽은 두 줄이다 — 돌려받은 {@code ref} 와 {@code onLayout} 을 그 요소에 그대로 준다.
 *
 * <p>화면 기준이 아니라 <b>창(window) 기준</b>으로 잰다. 가이드는 탭바 위까지 덮는 별도 창이라,
 * 화면 안 좌표로 재면 탭바의 촬영 버튼이 엉뚱한 자리에 비친다.
 *
 * <p><b>배치가 끝난 그 자리에서 바로 재면 안 된다.</b> 실기기에서 확인해 보니 그때는 창 기준
 * 자리가 아직 0,0 이라, 가이드가 화면 왼쪽 위 구석을 비췄다. 한 프레임 미뤄 재면 제자리가
 * 나온다. 그래도 놓치는 경우를 위해 재는 법을 맡겨 두고, 가이드가 열릴 때 다시 잰다.
 */
export function useSpotlightTarget(id: string) {
  const ref = useRef<View | null>(null);
  const frame = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);

  const measure = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      ref.current?.measureInWindow((x, y, width, height) => {
        // 0,0 은 아직 자리를 못 잡은 것이다 — 그 값으로 덮으면 구석을 비춘다.
        if (!width || !height || (x === 0 && y === 0)) return;
        setTargetRect(id, { x, y, width, height });
      });
    });
  }, [id]);

  useEffect(() => registerMeasure(id, measure), [id, measure]);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      clearTargetRect(id);
    },
    [id],
  );

  return { ref, onLayout: measure };
}
