import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import type { Ref } from 'react';

import { palette } from '@/constants/palette';
import { space, type } from '@/constants/tokens';

/**
 * 화면 안 탭 — 디자인 시스템 pen 「Tabs/Underline」. 칸은 같은 폭, 높이 44, 글자 body2-bold(고른 탭 text, 나머지 text-meta),
 * 고른 탭 아래 blue-deep 2px 밑줄(글자 폭 + 좌우 8), 전체 아래 1px border. 안내가 비출 탭은 `target`을 받는다.
 */
export function UnderlineTabs<K extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { key: K; label: string; target?: { ref: Ref<View>; onLayout: (e: LayoutChangeEvent) => void } }[];
  value: K | null;
  onChange: (next: K) => void;
}) {
  return (
    <View style={styles.row} accessibilityRole="tablist">
      {tabs.map(({ key, label, target }) => {
        const on = value === key;
        return (
          <View key={key} style={styles.slot} ref={target?.ref} onLayout={target?.onLayout}>
            <Pressable style={styles.tab} onPress={() => onChange(key)} accessibilityRole="tab" accessibilityState={{ selected: on }}>
              <View style={styles.inner}>
                <View style={styles.labelWrap}>
                  <Text style={[styles.label, on && styles.labelOn]} numberOfLines={1}>{label}</Text>
                </View>
                <View style={[styles.underline, on && styles.underlineOn]} />
              </View>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignSelf: 'stretch', borderBottomWidth: 1, borderBottomColor: palette.border },
  slot: { flex: 1 },
  tab: { height: 44, alignItems: 'center' },
  inner: { height: 44 },
  labelWrap: { flex: 1, justifyContent: 'center', paddingHorizontal: space[2] },
  label: { ...type.body2Bold, color: palette.textMeta },
  labelOn: { color: palette.text },
  underline: { height: 2, backgroundColor: 'transparent' },
  underlineOn: { backgroundColor: palette.blueDeep },
});
