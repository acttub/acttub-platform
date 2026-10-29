import Feather from '@expo/vector-icons/Feather';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { api } from '@/lib/api';
import { disposeAudioPlayer } from '@/lib/audio-dispose';
import { translate as t } from '@/lib/i18n';
import {
  markSegments,
  markedLineCount,
  pronunciationSettled,
  type PronunciationLine,
  type PronunciationMark,
  type PronunciationState,
} from '@/lib/reading/pronunciation-report';
import { latestRecordings } from '@/lib/reading/recording-plan';
import { isPlaybackExpired } from '@/lib/reading/session-cards';
import { fetchSession, getCurrent } from '@/lib/reading/store';
import type { SessionRecording } from '@/lib/reading/types';

/** 채점이 끝날 때까지 다시 묻는 간격과 최대 횟수(약 3분). */
const POLL_MS = 4_000;
const POLL_MAX = 45;
/** 어절만 들을 때 앞뒤로 더 트는 여유(10/22 시안 — 150ms). */
const PAD_MS = 150;

/**
 * 리딩 발음 보고서(SOMA-606, 실험·PRO 표시) — 리딩 완료 화면의 작은 줄에서 온다.
 * 대본대로 읽은 줄을 보이고, 이번 녹음에서 확실히 다르게 들린 어절만 주황으로 칠한다(한 줄에 최대 2개, 10/22 승인).
 * 들어 보기는 이번 녹음만 튼다 — 지난 녹음 비교·모범 음성은 넣지 않는다(10/22 사용자). 자동 판정이라 단정하지 않는다.
 */
export default function PronunciationReportScreen() {
  const insets = useSafeAreaInsets();
  const { sessionId } = useLocalSearchParams<{ sessionId?: string }>();
  const [state, setState] = useState<PronunciationState | null>(null);
  const [failed, setFailed] = useState(false);
  /** 서버가 이 사람에게 아직 보고서를 열지 않았다(404 pronunciation_not_available) — 실패가 아니라 준비 중. */
  const [notReady, setNotReady] = useState(false);
  const [recordings, setRecordings] = useState<SessionRecording[]>([]);
  const [playing, setPlaying] = useState<string | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const script = getCurrent();
  const latest = useMemo(() => latestRecordings(recordings), [recordings]);

  const loadRecordings = useCallback(async (): Promise<SessionRecording[]> => {
    if (!sessionId) return [];
    const detail = await fetchSession(sessionId).catch(() => null);
    if (detail && mounted.current) setRecordings(detail.recordings);
    return detail?.recordings ?? [];
  }, [sessionId]);

  useEffect(() => {
    mounted.current = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let tries = 0;
    const poll = async () => {
      if (!sessionId) return;
      try {
        const next = await api.getPronunciationReport(sessionId);
        if (!mounted.current) return;
        setState(next);
        tries += 1;
        if (!pronunciationSettled(next.status) && tries < POLL_MAX) timer = setTimeout(() => void poll(), POLL_MS);
      } catch (e) {
        if (!mounted.current) return;
        if ((e as { code?: unknown } | null)?.code === 'pronunciation_not_available') setNotReady(true);
        else setFailed(true);
      }
    };
    void poll();
    void loadRecordings();
    return () => {
      mounted.current = false;
      if (timer) clearTimeout(timer);
      if (stopTimer.current) clearTimeout(stopTimer.current);
      disposeAudioPlayer(playerRef.current);
      playerRef.current = null;
    };
  }, [sessionId, loadRecordings]);

  /** 보고서 줄 번호(대본 순서, 1부터)로 그 줄 id 를 찾는다. 글이 다르면 같은 글의 줄을 찾는다. */
  const lineIdOf = (line: PronunciationLine): string | null => {
    if (!script) return null;
    const at = line.lineNo - 1;
    if (script.lines[at]?.text === line.text) return script.lineIds[at] ?? null;
    const found = script.lines.findIndex((l) => l.text === line.text);
    return found >= 0 ? script.lineIds[found] ?? null : null;
  };

  const stop = () => {
    if (stopTimer.current) clearTimeout(stopTimer.current);
    stopTimer.current = null;
    disposeAudioPlayer(playerRef.current);
    playerRef.current = null;
    setPlaying(null);
  };

  const play = async (key: string, lineId: string, mark?: PronunciationMark) => {
    if (playing === key) {
      stop();
      return;
    }
    let rec = latest.get(lineId) ?? null;
    if (rec && isPlaybackExpired(rec)) rec = latestRecordings(await loadRecordings()).get(lineId) ?? null;
    if (!rec?.playback_url || !mounted.current) return;
    stop();
    const player = createAudioPlayer({ uri: rec.playback_url });
    playerRef.current = player;
    player.addListener('playbackStatusUpdate', (status) => {
      if (status.didJustFinish && playerRef.current === player && mounted.current) setPlaying(null);
    });
    if (mark?.startMs != null && mark.endMs != null) {
      const from = Math.max(0, mark.startMs - PAD_MS);
      await player.seekTo(from / 1000);
      stopTimer.current = setTimeout(() => {
        if (playerRef.current === player) stop();
      }, mark.endMs + PAD_MS - from);
    }
    player.play();
    setPlaying(key);
  };

  if (notReady) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={styles.dim}>{t('pronReport.notReady')}</Text>
      </View>
    );
  }
  if (failed || !sessionId) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={styles.dim}>{t('pronReport.failed')}</Text>
      </View>
    );
  }
  if (!state || !pronunciationSettled(state.status)) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={styles.dim}>{t('pronReport.waiting')}</Text>
      </View>
    );
  }
  if (state.status !== 'done' || !state.report) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={styles.dim}>{t(state.status === 'skipped' ? 'pronReport.skipped' : 'pronReport.failed')}</Text>
      </View>
    );
  }

  const report = state.report;
  const lines = report.lines ?? [];
  const markedCount = markedLineCount(report);
  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
      <Text style={styles.title}>{markedCount > 0 ? t('pronReport.titleSome', { count: markedCount }) : t('pronReport.titleNone')}</Text>
      <Text style={styles.sub}>{t('pronReport.sub')}</Text>
      {report.habit && (
        <View style={styles.habit}>
          <Text style={styles.habitKind}>{t('pronReport.habitKind')}</Text>
          <Text style={styles.habitText}>{report.habit.label}</Text>
        </View>
      )}

      {lines.map((line) => {
        const lineId = lineIdOf(line);
        const hasAudio = !!lineId && !!latest.get(lineId)?.playback_url;
        const lineKey = `line-${line.lineNo}`;
        return (
          <View key={line.lineNo} style={styles.line}>
            <Text style={styles.lineText}>
              {markSegments(line.text, line.marks).map((seg, i) => (
                <Text key={i} style={seg.marked ? styles.marked : undefined}>
                  {seg.text}
                </Text>
              ))}
            </Text>
            {hasAudio && (
              <View style={styles.actions}>
                {line.marks.map((mark) => {
                  const key = `${lineKey}-${mark.index}`;
                  return (
                    <Pressable key={key} onPress={() => void play(key, lineId!, mark)} hitSlop={8} accessibilityRole="button" style={styles.chip}>
                      <Feather name={playing === key ? 'square' : 'play'} size={12} color={palette.flameDeep} />
                      <Text style={styles.chipMarked}>{t('pronReport.playWord', { word: mark.word })}</Text>
                    </Pressable>
                  );
                })}
                <Pressable onPress={() => void play(lineKey, lineId!)} hitSlop={6} accessibilityRole="button" style={styles.chip}>
                  <Feather name={playing === lineKey ? 'square' : 'play'} size={12} color={palette.blueDeep} />
                  <Text style={styles.chipText}>{t('pronReport.playLine')}</Text>
                </Pressable>
              </View>
            )}
          </View>
        );
      })}

      {report.misheard.length > 0 && (
        <View style={styles.misheard}>
          <Text style={styles.sectionTitle}>{t('pronReport.misheardTitle')}</Text>
          {report.misheard.map((m, i) => (
            <Text key={i} style={styles.misheardRow}>{t('pronReport.misheardRow', { word: m.word, heard: m.heard })}</Text>
          ))}
        </View>
      )}
      <Text style={styles.note}>{t('pronReport.note')}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: 14, padding: 32 },
  dim: { color: palette.textDim, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  content: { paddingHorizontal: 20, paddingTop: 20, gap: 22 },
  title: { color: palette.text, fontSize: 22, fontWeight: '800', lineHeight: 30 },
  sub: { color: palette.textDim, fontSize: 14, lineHeight: 21, marginTop: -14 },
  habit: { gap: 4 },
  habitKind: { color: palette.textFaint, fontSize: 13, fontWeight: '600' },
  habitText: { color: palette.text, fontSize: 16, fontWeight: '600' },
  line: { gap: 10 },
  lineText: { color: palette.text, fontSize: 18, lineHeight: 28 },
  marked: { color: palette.flameDeep, fontWeight: '700', backgroundColor: palette.flameSoft },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: palette.bgSoft, borderRadius: 14, paddingVertical: 7, paddingHorizontal: 12 },
  chipText: { color: palette.blueDeep, fontSize: 13, fontWeight: '600' },
  chipMarked: { color: palette.flameDeep, fontSize: 13, fontWeight: '600' },
  misheard: { gap: 8 },
  sectionTitle: { color: palette.textFaint, fontSize: 13, fontWeight: '600' },
  misheardRow: { color: palette.text, fontSize: 15, lineHeight: 22 },
  note: { color: palette.textFaint, fontSize: 12, lineHeight: 18 },
});
