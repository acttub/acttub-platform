import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/ui/buttons';
import { palette } from '@/constants/palette';

const MASCOT = require('@/assets/images/mascot-coach.png');

/**
 * pen 「불러오기 실패」·「검색 결과 없음」(오디션 공고 lXdvoi·NQ33xk, SOMA-748) — 갸웃하는 마스코트 + 제목 22/800 +
 * 설명 한 줄. `action`이 있으면 바닥에 주 버튼(다시 시도)을 둔다. `hintTone="blue"`면 설명을 파란 안내로 쓴다.
 */
export function StateView({
  title,
  body,
  hintTone = 'dim',
  action,
}: {
  title: string;
  body?: string;
  hintTone?: 'dim' | 'blue';
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View style={styles.root}>
      <View style={styles.center}>
        <Image source={MASCOT} style={styles.mascot} contentFit="contain" accessibilityIgnoresInvertColors />
        <Text style={styles.title}>{title}</Text>
        {body ? <Text style={[styles.body, hintTone === 'blue' && styles.bodyBlue]}>{body}</Text> : null}
      </View>
      {action ? <PrimaryButton label={action.label} onPress={action.onPress} style={styles.action} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 24, paddingBottom: 24 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 48 },
  mascot: { width: 72, height: 80, marginBottom: 6 },
  title: { fontSize: 22, fontWeight: '800', lineHeight: 30, color: palette.text, textAlign: 'center' },
  body: { fontSize: 14, fontWeight: '500', lineHeight: 21, color: palette.textDim, textAlign: 'center' },
  bodyBlue: { fontWeight: '700', color: palette.blueDeep },
  action: { alignSelf: 'stretch' },
});
