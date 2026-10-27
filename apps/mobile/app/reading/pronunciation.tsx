import Feather from '@expo/vector-icons/Feather';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';

import { MASCOT, MASCOT_SIZE } from '@/components/ui/mascot';
import { StatusScreen } from '@/components/ui/status-screen';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
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
  const { sessionId } = useLocalSearchParams<{ sessionId?: string }>();
  const [state, setState] = useState<PronunciationState | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
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
      } catch {
        if (mounted.current) setFailed(true);
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
  }, [sessionId, loadRecordings, attempt]);

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

  const retry = () => {
    setFailed(false);
    setState(null);
    setAttempt((n) => n + 1);
  };
  if (failed || !sessionId || (state && pronunciationSettled(state.status) && state.status !== 'skipped' && !(state.status === 'done' && state.report))) {
    return (
      <StatusScreen
        title={t('pronReport.failedTitle')}
        body={t('pronReport.failed')}
        primary={sessionId ? { label: t('common.retry'), onPress: retry } : undefined}
      />
    );
  }
  if (!state || !pronunciationSettled(state.status)) {
    return (
      <View style={styles.waiting}>
        <Image source={MASCOT.reading} style={MASCOT_SIZE.xl} contentFit="contain" cachePolicy="memory-disk" accessibilityIgnoresInvertColors />
        <Text style={styles.waitingTitle}>{t('pronReport.waitingTitle')}</Text>
        <Text style={styles.waitingBody}>{t('pronReport.waiting')}</Text>
      </View>
    );
  }
  if (state.status === 'skipped' || !state.report) {
    return <StatusScreen kind="empty" mascot={MASCOT.reading} title={t('pronReport.skippedTitle')} body={t('pronReport.skipped')} />;
  }

  const report = state.report;
  const lines = report.lines ?? [];
  const markedCount = markedLineCount(report);
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
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
                      <Feather name={playing === key ? 'square' : 'play'} size={14} color={palette.amber} />
                      <Text style={styles.chipMarked}>{t('pronReport.playWord', { word: mark.word })}</Text>
                    </Pressable>
                  );
                })}
                <Pressable onPress={() => void play(lineKey, lineId!)} hitSlop={6} accessibilityRole="button" style={styles.chip}>
                  <Feather name={playing === lineKey ? 'square' : 'play'} size={14} color={palette.blueDeep} />
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
  waiting: { flex: 1, backgroundColor: palette.bg, alignItems: 'center', paddingTop: 96, paddingHorizontal: space.gutter, gap: space[3] },
  waitingTitle: { ...type.title2, color: palette.text, textAlign: 'center' },
  waitingBody: { ...type.body2, color: palette.textSub, textAlign: 'center' },
  content: { paddingHorizontal: space.gutter, paddingTop: space[4], paddingBottom: space[8], gap: space[6] },
  title: { ...type.title2, color: palette.text },
  sub: { ...type.body2, color: palette.textSub, marginTop: -space[5] },
  habit: { gap: space[1], backgroundColor: palette.bgSubtle, borderRadius: radius.lg, padding: space[4] },
  habitKind: { ...type.caption, color: palette.textMeta },
  habitText: { ...type.body1Bold, color: palette.text },
  line: { gap: space[2] },
  lineText: { ...type.body1, color: palette.text },
  marked: { ...type.body1Bold, color: palette.amber, backgroundColor: palette.amberSoft },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  chip: { flexDirection: 'row', alignItems: 'center', gap: space[1], height: 32, backgroundColor: palette.bgSoft, borderRadius: radius.md, paddingHorizontal: space[3] },
  chipText: { ...type.body2Bold, color: palette.blueDeep },
  chipMarked: { ...type.body2Bold, color: palette.text },
  misheard: { gap: space[2] },
  sectionTitle: { ...type.captionBold, color: palette.textMeta },
  misheardRow: { ...type.body2, color: palette.text },
  note: { ...type.caption, color: palette.textMeta },
});
