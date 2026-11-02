import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { translate as t } from '@/lib/i18n';

export type CommunitySection = 'challenge' | 'board';

const SECTIONS: { key: CommunitySection; label: string }[] = [
  { key: 'challenge', label: 'community.tabChallenge' },
  { key: 'board', label: 'community.tabBoard' },
];

/**
 * 커뮤니티 탭 맨 위 밑줄 탭(pen 「5. 커뮤니티」 Tabs/Underline-hug) — 큰 제목 대신 「챌린지」「게시판」.
 * 글자 title2, 고른 탭은 `text` + 2px `blue-deep` 밑줄, 나머지는 `text-meta`. 탭은 글자 폭만큼, 사이 20, 왼쪽 정렬.
 * `dot` 이면 「게시판」 옆에 새 글 빨간 점.
 */
export function CommunityTabs({
  value,
  onChange,
  dot,
}: {
  value: CommunitySection;
  onChange: (next: CommunitySection) => void;
  dot?: boolean;
}) {
  return (
    <View style={styles.row} accessibilityRole="tablist">
      {SECTIONS.map(({ key, label }) => {
        const on = value === key;
        const showDot = key === 'board' && !!dot && !on;
        return (
          <Pressable
            key={key}
            style={styles.tab}
            onPress={() => onChange(key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={showDot ? t('community.tabBoardNew') : t(label)}
            ph-label={`community_section_${key}`}>
            <View style={styles.labelWrap}>
              <Text style={[styles.label, on && styles.labelOn]}>{t(label)}</Text>
              {showDot ? <View style={styles.dot} testID="community-board-dot" /> : null}
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
  labelWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 3 },
  label: { ...type.title2, color: palette.textMeta },
  labelOn: { color: palette.text },
  dot: { width: 6, height: 6, borderRadius: radius.full, backgroundColor: palette.danger, alignSelf: 'flex-start', marginTop: space[3] },
  underline: { height: 2, backgroundColor: 'transparent' },
  underlineOn: { backgroundColor: palette.blueDeep },
});
