import { useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { shadowOverlay } from '@/constants/tokens';

const LONG_PRESS_MS = 300;

type Drag = { id: string; translation: number; shift: number };

/**
 * 길게 눌러 끌어 순서를 바꾸는 목록(포트폴리오 경력·사진). 끄는 동안 이웃 칸을 절반 넘게 지나면 자리를 바꾸고,
 * 놓을 때 순서가 바뀌었으면 `onReorder`에 새 순서를 넘긴다. 저장·실패 시 되돌림은 넘겨받는 쪽이 `items`로 한다.
 * 끄는 동안은 `onDragChange(true)`로 바깥 스크롤을 멈추게 한다.
 */
export function DragReorderList<T extends { id: string }>({
  items,
  axis,
  gap,
  disabled,
  renderItem,
  onReorder,
  onDragChange,
}: {
  items: readonly T[];
  axis: 'x' | 'y';
  gap: number;
  disabled?: boolean;
  renderItem: (item: T, index: number) => ReactNode;
  onReorder: (next: T[]) => void;
  onDragChange?: (dragging: boolean) => void;
}) {
  const [order, setOrder] = useState<readonly T[]>(items);
  const [drag, setDrag] = useState<Drag | null>(null);
  const sizes = useRef(new Map<string, number>());
  const live = useRef({ order, drag });
  live.current = { order, drag };
  // 끄는 동안만 자리를 바꾼 순서를 보이고, 그 밖에는 넘겨받은 순서(저장 결과·되돌림)를 그대로 그린다.
  const shown = drag ? order : items;

  const move = (id: string, translation: number) => {
    const current = live.current.drag;
    if (!current || current.id !== id) return;
    const next = [...live.current.order];
    let shift = current.shift;
    let index = next.findIndex((item) => item.id === id);
    let swapped = true;
    while (swapped) {
      swapped = false;
      const offset = translation - shift;
      const after = next[index + 1];
      const before = next[index - 1];
      const afterSpan = after ? (sizes.current.get(after.id) ?? 0) + gap : 0;
      const beforeSpan = before ? (sizes.current.get(before.id) ?? 0) + gap : 0;
      if (after && afterSpan > gap && offset > afterSpan / 2) {
        [next[index], next[index + 1]] = [next[index + 1], next[index]];
        shift += afterSpan;
        index += 1;
        swapped = true;
      } else if (before && beforeSpan > gap && offset < -beforeSpan / 2) {
        [next[index], next[index - 1]] = [next[index - 1], next[index]];
        shift -= beforeSpan;
        index -= 1;
        swapped = true;
      }
    }
    if (shift !== current.shift) {
      live.current.order = next;
      setOrder(next);
    }
    live.current.drag = { id, translation, shift };
    setDrag(live.current.drag);
  };

  const drop = () => {
    const { order: finalOrder, drag: current } = live.current;
    if (!current) return;
    live.current.drag = null;
    setDrag(null);
    onDragChange?.(false);
    const changed = finalOrder.some((item, i) => item.id !== items[i]?.id);
    if (changed) onReorder([...finalOrder]);
  };

  return (
    <View style={[axis === 'x' && styles.row, { gap }]}>
      {shown.map((item, index) => {
        const pan = Gesture.Pan()
          .activateAfterLongPress(LONG_PRESS_MS)
          .enabled(!disabled)
          .runOnJS(true)
          .withTestId(`drag-${item.id}`)
          .onStart(() => {
            onDragChange?.(true);
            live.current = { order: items, drag: { id: item.id, translation: 0, shift: 0 } };
            setOrder(items);
            setDrag(live.current.drag);
          })
          .onUpdate((e) => move(item.id, axis === 'x' ? e.translationX : e.translationY))
          .onFinalize(drop);
        const lifted = drag?.id === item.id;
        const offset = lifted ? drag.translation - drag.shift : 0;
        return (
          <GestureDetector key={item.id} gesture={pan}>
            <View
              testID={`drag-item-${item.id}`}
              collapsable={false}
              onLayout={(e) => sizes.current.set(item.id, axis === 'x' ? e.nativeEvent.layout.width : e.nativeEvent.layout.height)}
              style={
                lifted
                  ? [styles.lifted, { transform: axis === 'x' ? [{ translateX: offset }, { scale: 1.03 }] : [{ translateY: offset }, { scale: 1.02 }] }]
                  : null
              }>
              {renderItem(item, index)}
            </View>
          </GestureDetector>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  lifted: { zIndex: 1, ...shadowOverlay },
});
