import { StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';

/**
 * 화면 pen 「InlineEmpty」 — 목록 자리가 비었을 때 머리 아래에 두는 `bg-subtle` 상자(r-md, 안쪽 24·16).
 * 제목 body2-bold `text-sub`, 설명이 있으면 caption `text-meta`. 오류 색을 쓰지 않는다.
 */
export function InlineEmpty({ title, description }: { title: string; description?: string | null }) {
  return (
    <View style={styles.box}>
      <Text style={styles.title}>{title}</Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: 'center',
    gap: space[1.5],
    paddingVertical: space[6],
    paddingHorizontal: space[4],
    borderRadius: radius.md,
    backgroundColor: palette.bgSubtle,
  },
  title: { ...type.body2Bold, color: palette.textSub, textAlign: 'center' },
  description: { ...type.caption, color: palette.textMeta, textAlign: 'center' },
});
