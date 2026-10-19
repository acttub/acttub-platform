import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { PrimaryButton, SecondaryButton } from '@/components/ui/buttons';
import { palette } from '@/constants/palette';

const MASCOT = require('@/assets/images/mascot-coach.png');

/**
 * 한 장짜리 안내(pen 「카메라와 마이크가 필요해요」·「끊긴 코칭 이어 하기」, SOMA-748) —
 * 가운데 마스코트, 큰 제목 23/900, 설명 15/500, 아래에 주 버튼과 보조 버튼.
 */
export function CoachNotice({
  title,
  body,
  primary,
  secondary,
}: {
  title: string;
  body: string;
  primary: { label: string; onPress: () => void; loading?: boolean };
  secondary?: { label: string; onPress: () => void };
}) {
  return (
    <View style={styles.wrap}>
      <View style={styles.body}>
        <Image source={MASCOT} style={styles.mascot} contentFit="contain" accessibilityIgnoresInvertColors />
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.text}>{body}</Text>
      </View>
      <View style={styles.actions}>
        <PrimaryButton label={primary.label} onPress={primary.onPress} loading={primary.loading} />
        {secondary ? <SecondaryButton label={secondary.label} onPress={secondary.onPress} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: palette.bg },
  body: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24, gap: 12, paddingBottom: 40 },
  mascot: { width: 84, height: 94 },
  title: { fontSize: 23, fontWeight: '900', lineHeight: 33, color: palette.text, textAlign: 'center' },
  text: { fontSize: 15, fontWeight: '500', lineHeight: 23, color: palette.textDim, textAlign: 'center' },
  actions: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 10, gap: 10 },
});
