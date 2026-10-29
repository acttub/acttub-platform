import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { MASCOT, MASCOT_SIZE } from '@/components/ui/mascot';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { translate as t } from '@/lib/i18n';

/**
 * 질문 대화의 코치 머리줄 — 왼쪽 액티, 이름 「코치」(caption-bold), 아래 Chat/Bubble/Coach(bg-soft, r-lg, 꼬리 쪽 왼쪽 위만 r-xs,
 * 안쪽 [12,16]). 말풍선 아래 회색 한 줄(`below`, 경과 시간 등). 분석 대기(「영상 보는 중」)와 대화의 코치 질문이 같이 쓴다.
 */
export function CoachMessage({ children, below }: { children: ReactNode; below?: ReactNode }) {
  return (
    <View style={styles.row}>
      <Image source={MASCOT.coach} style={MASCOT_SIZE.chat} contentFit="contain" cachePolicy="memory-disk" accessibilityIgnoresInvertColors />
      <View style={styles.content}>
        <Text style={styles.name}>{t('coach.coachLabel')}</Text>
        <View style={styles.bubble}>{children}</View>
        {below ? <View style={styles.below}>{below}</View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space[2] },
  content: { flex: 1, minWidth: 0, gap: space[1] },
  name: { ...type.captionBold, color: palette.text },
  bubble: {
    alignSelf: 'flex-start',
    gap: space[1.5],
    backgroundColor: palette.bgSoft,
    borderRadius: radius.lg,
    borderTopLeftRadius: radius.xs,
    paddingVertical: space[3],
    paddingHorizontal: space[4],
  },
  below: { marginTop: space[1] },
});
