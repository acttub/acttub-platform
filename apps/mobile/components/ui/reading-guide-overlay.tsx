import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MASCOT } from '@/components/ui/mascot';
import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';

/**
 * 첫 리딩 안내(pen 7-1) — 두 번째 내 차례에서 한 번만. 대본 위를 어둡게 덮고 가운데에 액티를 크게 띄워
 * 눈·이전 대사·일시정지·다음 버튼을 말풍선으로 하나씩 설명한다. 「알겠어요」를 누르면 닫히고 이어 읽는다.
 * 리딩 진행 규칙은 건드리지 않는다(보이기만 한다).
 */
export function ReadingGuideOverlay({ onClose }: { onClose: () => void }) {
  const steps = ['reading.guideEye', 'reading.guidePrev', 'reading.guidePause', 'reading.guideNext'];
  return (
    <View style={styles.scrim} pointerEvents="auto" accessibilityViewIsModal>
      <Image source={MASCOT.reading} style={styles.mascot} contentFit="contain" cachePolicy="memory-disk" accessibilityIgnoresInvertColors />
      <Text style={styles.head}>{t('reading.guideHead')}</Text>
      <View style={styles.list}>
        {steps.map((key) => (
          <View key={key} style={styles.bubble}>
            <Text style={styles.bubbleText}>{t(key)}</Text>
          </View>
        ))}
      </View>
      <Pressable style={styles.ok} onPress={onClose} accessibilityRole="button" ph-label="reading_guide_ack">
        <Text style={styles.okText}>{t('reading.guideAck')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(17,24,39,0.82)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 12, zIndex: 50 },
  mascot: { width: 132, height: 148 },
  head: { color: '#fff', fontSize: 18, fontWeight: '800', lineHeight: 24, textAlign: 'center' },
  list: { alignSelf: 'stretch', gap: 8, marginTop: 4 },
  bubble: { backgroundColor: palette.bgSoft, borderRadius: 18, paddingVertical: 12, paddingHorizontal: 16 },
  bubbleText: { color: palette.text, fontSize: 15, fontWeight: '700', lineHeight: 22 },
  ok: { alignSelf: 'stretch', height: 52, borderRadius: 14, backgroundColor: palette.blue, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  okText: { color: palette.onAccent, fontSize: 17, fontWeight: '800' },
});
