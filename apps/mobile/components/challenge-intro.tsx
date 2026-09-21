import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';

/**
 * A14~A14.2 챌린지 시작 안내 — 기기당 한 번, 세 장.
 *
 * 마지막 장은 좋아요 랭킹이 무엇인지 분명히 말한다: 연기에 점수를 매기는 것이 아니라 사람들이
 * 누른 좋아요 수를 세운 것이다(ADR-005 개정). 넘기는 방향은 위아래다.
 */
const PAGES = [
  { title: 'challenges.introTitle1', body: 'challenges.introBody1' },
  { title: 'challenges.introTitle2', body: 'challenges.introBody2' },
  { title: 'challenges.introTitle3', body: 'challenges.introBody3' },
] as const;

export function ChallengeIntro({ visible, onDone }: { visible: boolean; onDone: () => void }) {
  const [page, setPage] = useState(0);
  const last = page === PAGES.length - 1;

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onDone}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{t(PAGES[page].title)}</Text>
          <Text style={styles.body}>{t(PAGES[page].body)}</Text>
          <View style={styles.dots}>
            {PAGES.map((p, i) => (
              <View key={p.title} style={[styles.dot, i === page && styles.dotOn]} />
            ))}
          </View>
          <Pressable
            style={styles.cta}
            onPress={() => (last ? onDone() : setPage((p) => p + 1))}
            accessibilityRole="button">
            <Text style={styles.ctaText}>{t(last ? 'challenges.introStart' : 'challenges.introNext')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: 28 },
  card: { width: '100%', backgroundColor: palette.bg, borderRadius: 20, padding: 24, gap: 12 },
  title: { fontSize: 21, fontWeight: '900', color: palette.text, lineHeight: 30 },
  body: { fontSize: 14.5, lineHeight: 23, color: palette.textDim },
  dots: { flexDirection: 'row', gap: 6, marginTop: 4 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: palette.border },
  dotOn: { backgroundColor: palette.blue, width: 18 },
  cta: { height: 50, borderRadius: 14, backgroundColor: palette.blue, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  ctaText: { fontSize: 15, fontWeight: '900', color: '#FFFFFF' },
});
