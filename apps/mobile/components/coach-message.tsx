import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { MASCOT, MASCOT_SIZE } from '@/components/ui/mascot';
import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';

/**
 * 질문 대화의 코치 머리줄 — pen 09 「Coach Message」. 왼쪽 액티 30×36, 9 띄워 이름 「ACTTUB 코치」 15/800 #D9622B,
 * 3 띄워 회색 말풍선(#F2F4F6, 모서리 18, 안쪽 [13,12], 줄 사이 6). 말풍선 아래 회색 한 줄(`below`, 경과 시간 등)은 4 더 띄운다.
 * 분석 대기(「영상 보는 중」)와 대화의 코치 질문이 같이 쓴다.
 */
export function CoachMessage({ children, below }: { children: ReactNode; below?: ReactNode }) {
  return (
    <View style={styles.row}>
      <Image source={MASCOT.coach} style={MASCOT_SIZE.chat} contentFit="contain" accessibilityIgnoresInvertColors />
      <View style={styles.content}>
        <Text style={styles.name}>{t('coach.coachLabel')}</Text>
        <View style={styles.bubble}>{children}</View>
        {below ? <View style={styles.below}>{below}</View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  content: { flex: 1, minWidth: 0, gap: 3 },
  name: { fontSize: 15, fontWeight: '800', lineHeight: 19, color: palette.coachName },
  bubble: { alignSelf: 'flex-start', gap: 6, backgroundColor: palette.bgSoft, borderRadius: 18, paddingVertical: 13, paddingHorizontal: 12 },
  below: { marginTop: 4 },
});
