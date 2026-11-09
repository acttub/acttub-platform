import { useFocusEffect } from 'expo-router';
import { useCallback, type DependencyList } from 'react';

/**
 * 화면이 보일 때마다 `load`를 부른다. 화면을 떠나거나 `deps`가 바뀌면 `alive()`가 false 가 되어 늦게 온 답을 버린다.
 * 받은 답을 화면 state 에 넣기 전에 `alive()`를 본다.
 */
export function useFocusLoad(load: (alive: () => boolean) => void, deps: DependencyList): void {
  useFocusEffect(
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useCallback(() => {
      let on = true;
      load(() => on);
      return () => {
        on = false;
      };
    }, deps),
  );
}
