import { useMemo } from 'react';
import { StyleSheet, Text, View, type TextStyle } from 'react-native';

import { palette } from '@/constants/palette';
import { diffWords } from '@/lib/reading/word-diff';

/**
 * 원문과 다르게 말한 대사 한 줄(reading.session) — 원문을 먼저 보이고 다르게 말한 어절은 노란 바탕,
 * 그 아래 말한 것을 작고 흐리게. 이름표는 없다. 완료 화면·전체 보기·회차 상세가 같이 쓴다.
 * said 가 null 이면(맞게 말했거나 비교하지 않은 줄) 원문만 보인다.
 */
export function DiffText({ target, said, textStyle }: { target: string; said: string | null; textStyle?: TextStyle }) {
  const words = useMemo(() => (said === null ? null : diffWords(target, said)), [target, said]);
  if (!words) return <Text style={[styles.text, textStyle]}>{target}</Text>;
  return (
    <View style={styles.box}>
      <Text style={[styles.text, textStyle]}>
        {words.map((w, i) => (
          <Text key={i}>
            {i > 0 ? ' ' : ''}
            <Text style={w.differs && styles.differs}>{w.text}</Text>
          </Text>
        ))}
      </Text>
      {!!said?.trim() && <Text style={styles.said}>{said}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 4 },
  text: { color: palette.text, fontFamily: 'Pretendard', fontSize: 15, lineHeight: 23 },
  differs: { backgroundColor: palette.amberSoft, fontFamily: 'Pretendard-Bold' },
  said: { color: palette.textFaint, fontFamily: 'Pretendard', fontSize: 12, lineHeight: 18 },
});
