import { Image } from 'expo-image';
import { useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/ui/buttons';
import { MASCOT as MASCOTS, MASCOT_SIZE } from '@/components/ui/mascot';
import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';

const MASCOT = MASCOTS.bow;

/**
 * A14~A14.2 챌린지 시작 안내 — 기기당 한 번, 세 장.
 *
 * 마지막 장은 좋아요 랭킹이 무엇인지 분명히 말한다: 연기에 점수를 매기는 것이 아니라 사람들이
 * 누른 좋아요 수를 세운 것이다(ADR-005 개정). 넘기는 방향은 위아래다.
 *
 * SOMA-748(rhxjLY): 마스코트 + 제목 줄, 파란 본문, 큰 파란 버튼 모양으로 바꿨다. 세 장은 정본(challenge/browse A14)대로
 * 둔다. 마지막 장에서 이번 주 대사가 있으면 버튼이 「이번 주 대사 보기」가 되어 그 대사 상세로 간다.
 */
const PAGES = [
  { title: 'challenges.introTitle1', body: 'challenges.introBody1' },
  { title: 'challenges.introTitle2', body: 'challenges.introBody2' },
  { title: 'challenges.introTitle3', body: 'challenges.introBody3' },
] as const;

export function ChallengeIntro({
  visible,
  onDone,
  canSeeWeek = false,
}: {
  visible: boolean;
  /** seeWeek 가 참이면 「이번 주 대사 보기」를 눌러 닫았다. */
  onDone: (seeWeek: boolean) => void;
  canSeeWeek?: boolean;
}) {
  const [page, setPage] = useState(0);
  const last = page === PAGES.length - 1;
  const ctaKey = !last ? 'challenges.introNext' : canSeeWeek ? 'challenges.introSeeWeek' : 'challenges.introStart';

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={() => onDone(false)}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.titleRow}>
            <Image source={MASCOT} style={styles.mascot} contentFit="contain" cachePolicy="memory-disk" accessibilityIgnoresInvertColors />
            <Text style={styles.title}>{t(PAGES[page].title)}</Text>
          </View>
          <Text style={styles.body}>{t(PAGES[page].body)}</Text>
          <View style={styles.dots}>
            {PAGES.map((p, i) => (
              <View key={p.title} style={[styles.dot, i === page && styles.dotOn]} />
            ))}
          </View>
          <PrimaryButton label={t(ctaKey)} onPress={() => (last ? onDone(canSeeWeek) : setPage((p) => p + 1))} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15, 20, 25, 0.65)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', backgroundColor: palette.bg, borderRadius: 20, paddingHorizontal: 24, paddingTop: 24, paddingBottom: 34, gap: 16 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  mascot: MASCOT_SIZE.sm,
  title: { flex: 1, fontSize: 21, fontWeight: '900', color: palette.text, lineHeight: 30 },
  body: { fontSize: 14, fontWeight: '700', lineHeight: 21, color: palette.blueDeep },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: palette.border },
  dotOn: { backgroundColor: palette.blue, width: 18 },
});
