import Feather from '@expo/vector-icons/Feather';
import { useFocusEffect, useRouter } from 'expo-router';
import { createAudioPlayer } from 'expo-audio';
import { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { getCurrent, loadIntoCurrent, updateCurrent, type Recording, type SavedScript } from '@/lib/reading/store';
import { translate as t } from '@/lib/i18n';

function ago(ts: number): string {
  const d = Math.floor((Date.now() - ts) / 86400000);
  if (d <= 0) return t('reading.today');
  if (d === 1) return t('reading.yesterday');
  if (d < 7) return `${d}일 전`;
  return new Date(ts).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
}
function mmss(sec: number): string {
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
}
function statusOf(s: SavedScript): { label: string; color: string } {
  if (s.status === 'done') return { label: t('reading.statusDone'), color: palette.green };
  if (s.myRoles.length === 0) return { label: t('reading.statusRole'), color: palette.textDim };
  return { label: t('reading.statusPlaying'), color: palette.blue };
}

export default function ReadingDetail() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [script, setScript] = useState<SavedScript | null>(getCurrent());
  const [playingId, setPlayingId] = useState<string | null>(null);
  const playerRef = useRef<any>(null);

  useFocusEffect(
    useCallback(() => {
      const id = getCurrent()?.id;
      if (id) void loadIntoCurrent(id).then((s) => setScript(s ? { ...s } : null));
      return () => {
        try {
          playerRef.current?.remove?.();
        } catch {}
        playerRef.current = null;
        setPlayingId(null);
      };
    }, []),
  );

  if (!script) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={styles.dim}>대본이 없어요.</Text>
        <Pressable style={styles.pill} onPress={() => router.replace('/reading')}>
          <Text style={styles.pillText}>내 대본으로</Text>
        </Pressable>
      </View>
    );
  }

  const st = statusOf(script);
  const total = script.endIndex - script.startIndex + 1;
  const pos = Math.min(Math.max(script.index - script.startIndex, 0), total);
  const recs = script.recordings;

  const playRec = (rec: Recording) => {
    try {
      playerRef.current?.remove?.();
    } catch {}
    if (playingId === rec.id) {
      playerRef.current = null;
      setPlayingId(null);
      return;
    }
    try {
      const p = createAudioPlayer({ uri: rec.uri });
      playerRef.current = p;
      p.play();
      setPlayingId(rec.id);
    } catch {
      setPlayingId(null);
    }
  };

  const startFresh = async () => {
    await updateCurrent({ index: script.startIndex, status: 'reading' });
    router.push('/reading/play');
  };
  const resume = () => router.push('/reading/play');

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]}>
        {/* 대본 요약 */}
        <View style={styles.summary}>
          <View style={styles.sumIcon}>
            <Feather name="file-text" size={20} color={palette.blue} />
          </View>
          <View style={styles.sumBody}>
            <Text style={styles.sumRole}>내 배역 · {script.myRoles.join(', ') || t('reading.unset')}</Text>
            <Text style={styles.sumMeta}>
              {script.dialogueCount}개 대사 · 녹음 {recs.length}개{recs.length ? ` · ${ago(recs[0].createdAt)} 연습` : ''}
            </Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.round((pos / total) * 100)}%`, backgroundColor: st.color }]} />
            </View>
          </View>
          <Text style={[styles.statusText, { color: st.color }]}>{st.label}</Text>
        </View>

        <Pressable style={styles.fullBtn} onPress={() => router.push('/reading/full')}>
          <View>
            <Text style={styles.fullTitle}>대본 전체보기</Text>
            <Text style={styles.fullSub}>{script.title}</Text>
          </View>
          <Feather name="chevron-right" size={20} color={palette.textFaint} />
        </Pressable>

        <View style={styles.recHead}>
          <Text style={styles.recTitle}>연습 녹음</Text>
          <Text style={styles.recCount}>전체 {recs.length}회</Text>
        </View>

        {recs.length === 0 ? (
          <View style={styles.emptyRec}>
            <Feather name="mic" size={28} color={palette.checkOff} />
            <Text style={styles.emptyRecText}>아직 녹음이 없어요. 연습하면 자동으로 녹음돼요.</Text>
          </View>
        ) : (
          <View style={styles.recList}>
            {recs.map((r, i) => {
              const round = recs.length - i;
              const pct = r.totalCount ? Math.round((r.coveredCount / r.totalCount) * 100) : 0;
              const playing = playingId === r.id;
              return (
                <View key={r.id} style={[styles.recCard, i === 0 && styles.recCardTop]}>
                  <View style={styles.recRow}>
                    <View style={styles.recLeft}>
                      <Text style={styles.recRound}>{round}회차</Text>
                      <Text style={styles.recDate}>· {ago(r.createdAt)}</Text>
                      {i === 0 && <View style={styles.latest}><Text style={styles.latestText}>가장 최근</Text></View>}
                    </View>
                    <Pressable style={[styles.playBtn, playing && styles.playBtnOn]} onPress={() => playRec(r)}>
                      <Feather name={playing ? 'pause' : 'play'} size={16} color={playing ? '#fff' : palette.blue} />
                    </Pressable>
                  </View>
                  <Text style={styles.recMeta}>{r.totalCount}개 중 {r.coveredCount}개 녹음 · {mmss(r.durationSec)}</Text>
                  <View style={styles.recProgRow}>
                    <View style={styles.recProgTrack}>
                      <View style={[styles.recProgFill, { width: `${pct}%`, backgroundColor: pct >= 100 ? palette.green : palette.blue }]} />
                    </View>
                    <Text style={[styles.recPct, { color: pct >= 100 ? palette.green : palette.blue }]}>{pct}%</Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Pressable style={[styles.foot, styles.footGhost]} onPress={startFresh}>
          <Feather name="plus" size={16} color={palette.blue} />
          <Text style={styles.footGhostText}>새로운 연습</Text>
        </Pressable>
        <Pressable style={[styles.foot, styles.footPrimary]} onPress={resume}>
          <Feather name="play" size={15} color="#fff" />
          <Text style={styles.footPrimaryText}>이어서 연습 · {Math.min(pos + 1, total)}/{total}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  dim: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 15 },
  content: { padding: 20, gap: 14 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: palette.card, borderColor: palette.border, borderWidth: 1, borderRadius: 16, padding: 16 },
  sumIcon: { width: 44, height: 44, borderRadius: 11, backgroundColor: palette.blueSoft, alignItems: 'center', justifyContent: 'center' },
  sumBody: { flex: 1, gap: 6 },
  sumRole: { color: palette.blueDeep, fontFamily: 'Pretendard-Bold', fontSize: 16 },
  sumMeta: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 12 },
  progressTrack: { height: 5, borderRadius: 3, backgroundColor: palette.bgSoft, overflow: 'hidden', marginTop: 2 },
  progressFill: { height: 5, borderRadius: 3 },
  statusText: { fontFamily: 'Pretendard-SemiBold', fontSize: 12, alignSelf: 'flex-end' },
  fullBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: palette.bgSubtle, borderColor: palette.border, borderWidth: 1, borderRadius: 14, padding: 16 },
  fullTitle: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 15 },
  fullSub: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 12, marginTop: 2 },
  recHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 4 },
  recTitle: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 16 },
  recCount: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 12 },
  emptyRec: { alignItems: 'center', gap: 8, paddingVertical: 40 },
  emptyRecText: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 13, textAlign: 'center' },
  recList: { gap: 10 },
  recCard: { backgroundColor: palette.card, borderColor: palette.border, borderWidth: 1, borderRadius: 14, padding: 14, gap: 8 },
  recCardTop: { borderColor: palette.blue, borderWidth: 1.5 },
  recRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  recLeft: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  recRound: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 15 },
  recDate: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 13 },
  latest: { backgroundColor: palette.blueSoft, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, marginLeft: 2 },
  latestText: { color: palette.blueDeep, fontFamily: 'Pretendard-SemiBold', fontSize: 11 },
  playBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: palette.blueSoft, alignItems: 'center', justifyContent: 'center' },
  playBtnOn: { backgroundColor: palette.blue },
  recMeta: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 12 },
  recProgRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  recProgTrack: { flex: 1, height: 5, borderRadius: 3, backgroundColor: palette.bgSoft, overflow: 'hidden' },
  recProgFill: { height: 5, borderRadius: 3 },
  recPct: { fontFamily: 'Pretendard-Bold', fontSize: 12, width: 40, textAlign: 'right' },
  footer: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 12, borderTopColor: palette.borderSoft, borderTopWidth: 1, backgroundColor: palette.bg },
  foot: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 12, paddingVertical: 15 },
  footGhost: { backgroundColor: palette.blueSoft },
  footGhostText: { color: palette.blueDeep, fontFamily: 'Pretendard-SemiBold', fontSize: 15 },
  footPrimary: { flex: 1.4, backgroundColor: palette.blue },
  footPrimaryText: { color: '#fff', fontFamily: 'Pretendard-Bold', fontSize: 15 },
  pill: { backgroundColor: palette.blue, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 11 },
  pillText: { color: '#fff', fontFamily: 'Pretendard-SemiBold', fontSize: 14 },
});
