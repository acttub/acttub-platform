import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';
import { space, type } from '@/constants/tokens';
import { translate as t } from '@/lib/i18n';
import type { PracticeMode } from '@/lib/practice-mode';

const MODES: PracticeMode[] = ['reading', 'coaching'];

/**
 * 연습 탭 맨 위 밑줄 탭 「리딩」「코칭」 — 예전 커뮤니티 탭의 「챌린지 | 게시판」(pen 「5. 커뮤니티」 Tabs/Underline-hug)과 같은 모양이고,
 * 탭 첫 화면 머리(NavHeader/Large)의 큰 제목 자리에 들어간다. 글자 title2, 고른 쪽은 `text` + 2px `blue-deep` 밑줄,
 * 나머지는 `text-meta`. 탭은 글자 폭만큼, 사이 20, 왼쪽 정렬.
 */
export function PracticeModeTabs({ value, onChange }: { value: PracticeMode; onChange: (next: PracticeMode) => void }) {
  return (
    <View style={styles.row} accessibilityRole="tablist">
      {MODES.map((mode) => {
        const on = value === mode;
        return (
          <Pressable
            key={mode}
            style={styles.tab}
            onPress={() => {
              if (!on) onChange(mode);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={t(`tabs.${mode}`)}
            ph-label={`practice_mode_${mode}`}>
            <View style={styles.labelWrap}>
              <Text style={[styles.label, on && styles.labelOn]}>{t(`tabs.${mode}`)}</Text>
            </View>
            <View style={[styles.underline, on && styles.underlineOn]} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignSelf: 'stretch', gap: space[5] },
  tab: { height: 56 },
  labelWrap: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  label: { ...type.title2, color: palette.textMeta },
  labelOn: { color: palette.text },
  underline: { height: 2, backgroundColor: 'transparent' },
  underlineOn: { backgroundColor: palette.blueDeep },
});
