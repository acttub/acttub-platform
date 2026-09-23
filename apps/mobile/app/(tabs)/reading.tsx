import Feather from '@expo/vector-icons/Feather';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SpotlightGuide, type SpotlightStep } from '@/components/spotlight-guide';
import { palette } from '@/constants/palette';
import { useSpotlightTarget } from '@/hooks/use-spotlight-target';
import { hasSeenSpotlight, markSpotlightSeen } from '@/lib/guide-state';
import { TARGET } from '@/lib/spotlight-targets';
import { listScripts, loadIntoCurrent, type SavedScript } from '@/lib/reading/store';
import { translate as t } from '@/lib/i18n';

/** 대본 탭에서 처음 한 번 비추는 자리 — 대본을 들이는 버튼 하나뿐이다 (SOMA-550). */
const READING_STEPS: SpotlightStep[] = [{ target: TARGET.readingNew, text: 'guide.spotReadingNew' }];

function statusOf(s: SavedScript): { label: string; color: string; bg: string } {
  if (s.status === 'done') return { label: t('reading.statusDone'), color: palette.green, bg: palette.greenSoft };
  if (s.myRoles.length === 0) return { label: t('reading.statusRole'), color: palette.textDim, bg: palette.bgSoft };
  return { label: t('reading.statusPlaying'), color: palette.blue, bg: palette.blueSoft };
}

export default function ReadingList() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [scripts, setScripts] = useState<SavedScript[]>([]);
  const [q, setQ] = useState('');
  // 대본 탭에서 처음 한 번만 — 홈 가이드와 따로 센다 (SOMA-550).
  const [guideOpen, setGuideOpen] = useState(false);
  const newTarget = useSpotlightTarget(TARGET.readingNew);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void listScripts().then((list) => alive && setScripts(list));
      // 올 때마다 묻는다 — 설정에서 되살린 뒤 앱을 다시 켜야 보이면 아무도 못 본다.
      void hasSeenSpotlight('reading').then((seen) => {
        if (alive && !seen) setGuideOpen(true);
      });
      return () => {
        alive = false;
      };
    }, []),
  );

  const filtered = useMemo(() => {
    const kw = q.trim();
    if (!kw) return scripts;
    return scripts.filter(
      (s) => s.title.includes(kw) || s.roles.some((r) => r.includes(kw)) || s.lines.some((l) => l.type === 'dialogue' && l.text.includes(kw)),
    );
  }, [scripts, q]);

  const open = async (s: SavedScript) => {
    await loadIntoCurrent(s.id);
    router.push(s.myRoles.length === 0 ? '/reading/roles' : '/reading/detail');
  };
  const memorize = async (s: SavedScript) => {
    await loadIntoCurrent(s.id);
    router.push('/reading/memorize');
  };

  const inProgress = scripts.filter((s) => s.status !== 'done').length;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 110 }]}>
      <Text style={styles.h1}>내 대본</Text>

      <View style={styles.searchRow}>
        <View style={styles.search}>
          <Feather name="search" size={16} color={palette.textFaint} />
          <TextInput
            style={styles.searchInput}
            value={q}
            onChangeText={setQ}
            placeholder={t('reading.searchPlaceholder')}
            placeholderTextColor={palette.textFaint}
          />
        </View>
        <Pressable
          ref={newTarget.ref}
          onLayout={newTarget.onLayout}
          style={styles.newBtn}
          onPress={() => router.push('/reading/new')}>
          <Feather name="plus" size={16} color="#fff" />
          <Text style={styles.newText}>새 대본</Text>
        </Pressable>
      </View>

      {scripts.length > 0 && (
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>업로드한 대본</Text>
          <Text style={styles.sectionCount}>총 {scripts.length}개 · 연습 중 {inProgress}개</Text>
        </View>
      )}

      {scripts.length === 0 ? (
        <View style={styles.empty}>
          <Feather name="book-open" size={34} color={palette.checkOff} />
          <Text style={styles.emptyTitle}>아직 대본이 없어요</Text>
          <Text style={styles.emptySub}>대본을 넣으면 상대 배역을 앱이 읽어줘요. 새 대본으로 시작해요.</Text>
          <Pressable style={styles.emptyBtn} onPress={() => router.push('/reading/new')}>
            <Feather name="plus" size={16} color="#fff" />
            <Text style={styles.newText}>새 대본</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.list}>
          {filtered.map((s) => {
            const st = statusOf(s);
            const ratio = s.lines.length ? Math.min(1, s.index / s.lines.length) : 0;
            return (
              <Pressable key={s.id} style={styles.card} onPress={() => open(s)}>
                <View style={styles.cardIcon}>
                  <Feather name="file-text" size={18} color={palette.blue} />
                </View>
                <View style={styles.cardBody}>
                  <Text style={styles.cardTitle} numberOfLines={1}>{s.title}</Text>
                  <Text style={styles.cardMeta}>
                    {s.myRoles.length ? `${s.myRoles.join(', ')} · ` : ''}대사 {s.dialogueCount}개
                    {s.recordings.length ? ` · 녹음 ${s.recordings.length}개` : ''}
                  </Text>
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${Math.round(ratio * 100)}%`, backgroundColor: st.color }]} />
                  </View>
                </View>
                <View style={styles.cardRight}>
                  <View style={[styles.pill, { backgroundColor: st.bg }]}>
                    <Text style={[styles.pillText, { color: st.color }]}>{st.label}</Text>
                  </View>
                  {s.myRoles.length > 0 && (
                    <Pressable
                      style={styles.memoChip}
                      onPress={(e) => {
                        e.stopPropagation();
                        void memorize(s);
                      }}>
                      <Feather name="edit-3" size={12} color={palette.blueDeep} />
                      <Text style={styles.memoChipText}>암기</Text>
                    </Pressable>
                  )}
                </View>
              </Pressable>
            );
          })}
          {filtered.length === 0 && <Text style={styles.noMatch}>검색 결과가 없어요.</Text>}
        </View>
      )}

      {/* 가이드는 제 창에 뜬다 — 목록 어디에 두든 자리를 차지하지 않는다. */}
      <SpotlightGuide
        visible={guideOpen}
        topic="reading"
        steps={READING_STEPS}
        onDone={() => {
          setGuideOpen(false);
          void markSpotlightSeen('reading');
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  content: { padding: 20, paddingTop: 64, gap: 14 },
  h1: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 26 },
  searchRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: palette.bgSoft, borderRadius: 12, paddingHorizontal: 12, height: 46 },
  searchInput: { flex: 1, color: palette.text, fontFamily: 'Pretendard', fontSize: 14, padding: 0 },
  newBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: palette.blue, borderRadius: 12, paddingHorizontal: 14, height: 46 },
  newText: { color: '#fff', fontFamily: 'Pretendard-SemiBold', fontSize: 14 },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 4 },
  sectionTitle: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 16 },
  sectionCount: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 12 },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 60 },
  emptyTitle: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 17, marginTop: 6 },
  emptySub: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 13, textAlign: 'center', lineHeight: 20, paddingHorizontal: 20 },
  emptyBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: palette.blue, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 12, marginTop: 8 },
  list: { gap: 10 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: palette.card, borderColor: palette.border, borderWidth: 1, borderRadius: 14, padding: 14 },
  cardIcon: { width: 40, height: 40, borderRadius: 10, backgroundColor: palette.blueSoft, alignItems: 'center', justifyContent: 'center' },
  cardBody: { flex: 1, gap: 6 },
  cardTitle: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 15 },
  cardMeta: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 12 },
  progressTrack: { height: 4, borderRadius: 2, backgroundColor: palette.bgSoft, overflow: 'hidden', marginTop: 2 },
  progressFill: { height: 4, borderRadius: 2 },
  cardRight: { alignItems: 'flex-end', gap: 6 },
  pill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  pillText: { fontFamily: 'Pretendard-SemiBold', fontSize: 12 },
  memoChip: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: palette.blueSoft, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  memoChipText: { color: palette.blueDeep, fontFamily: 'Pretendard-SemiBold', fontSize: 11 },
  noMatch: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 14, textAlign: 'center', paddingVertical: 24 },
});
