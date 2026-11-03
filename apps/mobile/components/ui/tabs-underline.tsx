import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';
import { space, type } from '@/constants/tokens';

/**
 * 디자인 시스템 pen 「Tabs/Underline」 — 화면 안 내용을 통째로 바꾸는 탭. 칸은 같은 폭, 높이 44, 글자 body2-bold(고른 탭 text, 나머지 text-meta).
 * 고른 탭 아래 blue-deep 2px 밑줄(글자 폭 + 좌우 8), 전체 아래 1px border.
 */
export function TabsUnderline<K extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: readonly (readonly [K, string])[];
  value: K;
  onChange: (key: K) => void;
}) {
  return (
    <View style={styles.row}>
      {tabs.map(([key, label]) => {
        const on = key === value;
        return (
          <Pressable key={key} style={styles.tab} onPress={() => onChange(key)} accessibilityRole="tab" accessibilityState={{ selected: on }}>
            <View style={styles.labelWrap}>
              <Text style={[styles.label, on && styles.labelOn]}>{label}</Text>
              {on && <View style={styles.underline} />}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: palette.border },
  tab: { flex: 1, height: 44, alignItems: 'center' },
  labelWrap: { height: 44, justifyContent: 'center', paddingHorizontal: space[2] },
  label: { ...type.body2Bold, color: palette.textMeta },
  labelOn: { color: palette.text },
  underline: { position: 'absolute', left: 0, right: 0, bottom: -1, height: 2, backgroundColor: palette.blueDeep },
});
