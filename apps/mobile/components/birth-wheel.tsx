import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';

/** 줄 높이와 한 번에 보이는 줄 수(가운데가 고른 값). */
export const WHEEL_ITEM_HEIGHT = 44;
const VISIBLE_ROWS = 5;
const PAD = WHEEL_ITEM_HEIGHT * Math.floor(VISIBLE_ROWS / 2);

export type BirthParts = { year: number; month: number; day: number };

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 「YYYY-MM-DD」를 나눈다. 모양이 틀리면 null. */
export function parseBirthDate(value: string): BirthParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function formatBirthParts({ year, month, day }: BirthParts): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function Wheel({
  values,
  selected,
  unit,
  label,
  onSelect,
  testID,
  onTouchActive,
}: {
  values: readonly number[];
  selected: number;
  unit: string;
  label: string;
  onSelect: (value: number) => void;
  testID: string;
  onTouchActive?: (active: boolean) => void;
}) {
  const ref = useRef<ScrollView>(null);
  const index = Math.max(0, values.indexOf(selected));
  // 굵게 칠하는 줄은 마지막으로 고른 값이 아니라 지금 가운데 칸에 걸린 줄이다 — 스크롤하는 동안에도 따라간다(SOMA-923).
  const [live, setLive] = useState(index);
  useEffect(() => setLive(index), [index]);
  const track = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const at = Math.min(values.length - 1, Math.max(0, Math.round(event.nativeEvent.contentOffset.y / WHEEL_ITEM_HEIGHT)));
    setLive((current) => (current === at ? current : at));
  };
  // 값이 밖에서 바뀌면(달이 바뀌어 일 수가 줄어든 경우 등) 그 자리로 옮긴다.
  useEffect(() => {
    ref.current?.scrollTo({ y: index * WHEEL_ITEM_HEIGHT, animated: false });
  }, [index, values.length]);
  const settle = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(event.nativeEvent.contentOffset.y / WHEEL_ITEM_HEIGHT);
    const value = values[Math.min(values.length - 1, Math.max(0, next))];
    if (value !== undefined && value !== selected) onSelect(value);
  };
  return (
    <ScrollView
      ref={ref}
      testID={testID}
      style={styles.column}
      showsVerticalScrollIndicator={false}
      snapToInterval={WHEEL_ITEM_HEIGHT}
      decelerationRate="fast"
      contentOffset={{ x: 0, y: index * WHEEL_ITEM_HEIGHT }}
      contentContainerStyle={{ paddingVertical: PAD }}
      // 바깥 화면도 세로 스크롤이라 손가락이 둘 다에 걸렸다(10/25 제보). 안드로이드는 안쪽이 먼저 받게 하고,
      // 휠을 만지는 동안은 바깥 스크롤을 멈춘다(onTouchActive). 값은 칸에 붙은 뒤(onMomentumScrollEnd)에만 고른다 —
      // 손을 뗄 때 고르면 다시 그리며 옮기는 scrollTo 가 안드로이드의 칸 맞춤을 끊어 반 칸 어긋난 채 멈췄다.
      nestedScrollEnabled
      onTouchStart={() => onTouchActive?.(true)}
      onTouchEnd={() => onTouchActive?.(false)}
      onTouchCancel={() => onTouchActive?.(false)}
      onMomentumScrollEnd={settle}
      onScroll={track}
      scrollEventThrottle={16}
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: `${selected}${unit}` }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) => {
        const step = event.nativeEvent.actionName === 'increment' ? 1 : -1;
        const next = values[Math.min(values.length - 1, Math.max(0, index + step))];
        if (next !== undefined) onSelect(next);
      }}>
      {values.map((value) => {
        const distance = Math.abs(values.indexOf(value) - live);
        return (
          <View key={value} style={styles.item}>
            <Text
              style={[
                styles.itemText,
                distance === 0 && styles.itemOn,
                distance === 1 && styles.itemNear,
                distance >= 2 && styles.itemFar,
              ]}>
              {value}
              {unit}
            </Text>
          </View>
        );
      })}
    </ScrollView>
  );
}

/**
 * pen S5.18 생년월일 — 연 · 월 · 일 세 줄이 따로 돌아가고 가운데 회색 띠에 걸린 값이 고른 값이다.
 * 일 수는 달에 맞춰 줄어들고, 값이 바뀔 때마다 「YYYY-MM-DD」로 알린다.
 */
export function BirthWheel({
  value,
  years,
  onChange,
  onTouchActive,
}: {
  value: BirthParts;
  years: readonly number[];
  onChange: (parts: BirthParts) => void;
  /** 휠을 만지는 동안 true — 바깥 ScrollView 의 scrollEnabled 를 끄는 데 쓴다. */
  onTouchActive?: (active: boolean) => void;
}) {
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const days = Array.from({ length: daysInMonth(value.year, value.month) }, (_, i) => i + 1);
  const change = (patch: Partial<BirthParts>) => {
    const next = { ...value, ...patch };
    next.day = Math.min(next.day, daysInMonth(next.year, next.month));
    onChange(next);
  };
  return (
    <View style={styles.wheel}>
      <View style={styles.band} pointerEvents="none" />
      <Wheel
        testID="birth-year"
        values={years}
        selected={value.year}
        unit={t('profileName.yearUnit')}
        label={t('profileName.yearLabel')}
        onSelect={(year) => change({ year })}
        onTouchActive={onTouchActive}
      />
      <Wheel
        testID="birth-month"
        values={months}
        selected={value.month}
        unit={t('profileName.monthUnit')}
        label={t('profileName.monthLabel')}
        onSelect={(month) => change({ month })}
        onTouchActive={onTouchActive}
      />
      <Wheel
        testID="birth-day"
        values={days}
        selected={value.day}
        unit={t('profileName.dayUnit')}
        label={t('profileName.dayLabel')}
        onSelect={(day) => change({ day })}
        onTouchActive={onTouchActive}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wheel: { height: WHEEL_ITEM_HEIGHT * VISIBLE_ROWS, flexDirection: 'row', justifyContent: 'center' },
  band: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: PAD,
    height: WHEEL_ITEM_HEIGHT,
    borderRadius: 12,
    // 고르는 칸을 진하게 — 옅은 파랑 바탕에 파란 테두리(SOMA-923).
    borderWidth: 1.5,
    borderColor: palette.blue,
    backgroundColor: palette.blueSoft,
  },
  column: { flex: 1 },
  item: { height: WHEEL_ITEM_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  itemText: { fontSize: 17, fontWeight: '600', color: palette.text },
  itemOn: { fontSize: 20, fontWeight: '800', color: palette.text },
  itemNear: { color: palette.checkOff },
  itemFar: { color: palette.border },
});
