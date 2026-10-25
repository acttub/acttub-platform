import { StyleSheet, Text, View, type TextStyle } from 'react-native';

import { palette } from '@/constants/palette';
import type { DifferentLine } from '@/lib/reading/types';

/**
 * 원문과 다르게 말한 대사 한 줄(reading.session) — 원문을 먼저 보이고 서버가 표시한 어절은 노란 바탕,
 * 그 아래 말한 것을 작고 흐리게. 이름표는 없다. 완료 화면·전체 보기·회차 상세가 같이 쓴다.
 * different 가 없거나 말한 것이 없으면(맞게 말했거나 결과만 저장된 줄) 원문만 보인다.
 */
export function DiffText({
  text,
  different,
  textStyle,
  saidLabel,
}: {
  text: string;
  different: DifferentLine | null;
  textStyle?: TextStyle;
  /** 말한 것 위 작은 이름표 — 전체 보기(pen R9.26 「내가 말한 것」)에서만 준다. */
  saidLabel?: string;
}) {
  if (!different || different.said === null) return <Text style={[styles.text, textStyle]}>{text}</Text>;
  return (
    <View style={styles.box}>
      <Text style={[styles.text, textStyle]}>
        {different.different_words.map((w, i) => (
          <Text key={i}>
            {i > 0 ? ' ' : ''}
            <Text style={w.differs && styles.differs}>{w.text}</Text>
          </Text>
        ))}
      </Text>
      {!!different.said.trim() && (
        <View style={styles.saidBox}>
          {!!saidLabel && <Text style={styles.saidLabel}>{saidLabel}</Text>}
          <Text style={[styles.said, !!saidLabel && styles.saidFull]}>{different.said}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 4 },
  text: { color: palette.text, fontFamily: 'Pretendard', fontSize: 15, lineHeight: 23 },
  differs: { backgroundColor: palette.amberSoft, fontFamily: 'Pretendard-Bold' },
  said: { color: palette.textFaint, fontFamily: 'Pretendard', fontSize: 12, lineHeight: 18 },
  // pen R9.26 「내가 말한 것」 — 전체 보기에서는 14 반굵게 회색.
  saidFull: { color: palette.textMuted, fontFamily: 'Pretendard-SemiBold', fontSize: 14, lineHeight: 20 },
  saidBox: { gap: 2 },
  saidLabel: { color: palette.textFaint, fontFamily: 'Pretendard-Bold', fontSize: 12 },
});
