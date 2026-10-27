import Feather from '@expo/vector-icons/Feather';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';

/**
 * 챌린지 대사 카드 — 챌린지 상세·지난주 결과가 같이 쓴다. `text` 바탕, r-lg, 안쪽 20.
 * 위 알약(주최·기간) → 대사(title2) → 작품·인물 → 그 아래 줄(caption `on-media-sub`).
 */
export function ChallengeLineCard({
  pill,
  line,
  meta,
  children,
}: {
  pill: string;
  line: string;
  /** 작품·인물·장면 메모·참여 수처럼 대사 아래 흐린 줄. 빈 값은 빼고 그린다. */
  meta: (string | null | undefined)[];
  children?: ReactNode;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.pill}>
        <Feather name="zap" size={12} color={palette.onAccent} />
        <Text style={styles.pillText}>{pill}</Text>
      </View>
      <Text style={styles.line}>“{line}”</Text>
      {meta.filter(Boolean).map((text) => (
        <Text key={text} style={styles.meta}>
          {text}
        </Text>
      ))}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: palette.text, borderRadius: radius.lg, padding: space[5], gap: space[2] },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    alignSelf: 'flex-start',
    backgroundColor: palette.textSub,
    borderRadius: radius.full,
    paddingHorizontal: space[2],
    paddingVertical: space[1],
  },
  pillText: { ...type.micro, color: palette.onAccent },
  line: { ...type.title2, color: palette.onAccent },
  meta: { ...type.caption, color: palette.onMediaSub },
});
