import Feather from '@expo/vector-icons/Feather';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ReadingNoScript } from '@/components/reading/no-script';
import { MASCOT } from '@/components/ui/mascot';
import { StatusScreen } from '@/components/ui/status-screen';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { logEvent } from '@/lib/analytics';
import { disposeAudioPlayer } from '@/lib/audio-dispose';
import { translate as t } from '@/lib/i18n';
import { compareRows, lengthChange, type CompareRow } from '@/lib/reading/compare';
import { onRecordingQueueChange } from '@/lib/reading/recording-runner';
import { isPlaybackExpired } from '@/lib/reading/session-cards';
import { fetchSession, getCurrent } from '@/lib/reading/store';
import type { SessionRecording } from '@/lib/reading/types';

type Loaded = { status: 'loading' } | { status: 'failed' } | { status: 'ready'; previous: SessionRecording[]; current: SessionRecording[] };
type Playing = { lineId: string; which: 'previous' | 'current' } | null;

/**
 * 지난번과 비교(SOMA-863). 같은 대본의 지난 회차와 이번 회차에서 둘 다 녹음이 남은 내 대사만 보이고,
 * 「차례로 듣기」를 누르면 지난번 녹음 → 이번 녹음 순서로 튼다. 달라진 점은 녹음 길이만 말한다.
 */
export default function ReadingCompare() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const script = getCurrent();
  const params = useLocalSearchParams<{ prev?: string; cur?: string }>();
  const prevId = typeof params.prev === 'string' ? params.prev : '';
  const curId = typeof params.cur === 'string' ? params.cur : '';
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [playing, setPlaying] = useState<Playing>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const mounted = useRef(true);
  const logged = useRef(false);

  const load = useCallback(async (): Promise<Loaded> => {
    const [previous, current] = await Promise.all([fetchSession(prevId), fetchSession(curId)]);
    const next: Loaded = previous && current
      ? { status: 'ready', previous: previous.recordings, current: current.recordings }
      : { status: 'failed' };
    if (mounted.current) setLoaded((was) => (next.status === 'failed' && was.status === 'ready' ? was : next));
    return next;
  }, [prevId, curId]);

  useEffect(() => {
    mounted.current = true;
    void load();
    // 이번 회차 녹음은 완료 뒤에도 올라가는 중일 수 있다 — 큐가 바뀌면 다시 묻는다.
    const off = onRecordingQueueChange(() => void load());
    return () => {
      mounted.current = false;
      off();
      disposeAudioPlayer(playerRef.current);
      playerRef.current = null;
    };
  }, [load]);

  const rows = useMemo(
    () => (script && loaded.status === 'ready' ? compareRows(script.lineIds, loaded.previous, loaded.current) : []),
    [script, loaded],
  );

  useEffect(() => {
    if (loaded.status !== 'ready' || logged.current) return;
    logged.current = true;
    void logEvent('reading_compare_open', { lines: rows.length });
  }, [loaded, rows.length]);

  const stop = () => {
    disposeAudioPlayer(playerRef.current);
    playerRef.current = null;
    setPlaying(null);
  };

  const freshRow = async (row: CompareRow): Promise<CompareRow | null> => {
    if (!isPlaybackExpired(row.previous) && !isPlaybackExpired(row.current)) return row;
    const next = await load();
    if (next.status !== 'ready' || !script) return null;
    return compareRows([row.lineId], next.previous, next.current)[0] ?? null;
  };

  const playOne = (lineId: string, which: 'previous' | 'current', rec: SessionRecording, then?: () => void) => {
    if (!rec.playback_url || !mounted.current) return;
    disposeAudioPlayer(playerRef.current);
    const player = createAudioPlayer({ uri: rec.playback_url });
    playerRef.current = player;
    player.addListener('playbackStatusUpdate', (status) => {
      if (!status.didJustFinish || playerRef.current !== player || !mounted.current) return;
      if (then) then();
      else stop();
    });
    player.play();
    setPlaying({ lineId, which });
  };

  const playBoth = async (row: CompareRow) => {
    if (playing?.lineId === row.lineId) {
      stop();
      return;
    }
    const fresh = await freshRow(row);
    if (!fresh) return;
    void logEvent('reading_compare_play', {});
    playOne(fresh.lineId, 'previous', fresh.previous, () => playOne(fresh.lineId, 'current', fresh.current));
  };

  if (!script) return <ReadingNoScript />;
  if (loaded.status === 'loading') return <View style={styles.root} />;
  if (loaded.status === 'failed') {
    return <StatusScreen mascot={MASCOT.reading} title={t('reading.compareLoadFail')} primary={{ label: t('common.retry'), onPress: () => void load() }} />;
  }
  if (rows.length === 0) {
    return <StatusScreen mascot={MASCOT.reading} title={t('reading.compareEmpty')} primary={{ label: t('reading.diffBack'), onPress: () => router.back() }} />;
  }

  const lineOf = (lineId: string) => script.lines[script.lineIds.indexOf(lineId)];

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
      <Text style={styles.count}>{t('reading.compareCount', { count: rows.length })}</Text>
      <Text style={styles.note}>{t('reading.compareNote')}</Text>
      {rows.map((row) => {
        const line = lineOf(row.lineId);
        const change = lengthChange(row.previous.duration_ms, row.current.duration_ms);
        const changeText =
          change.kind === 'same'
            ? t('reading.compareSame', { prev: change.previousSec, cur: change.currentSec })
            : t(change.kind === 'shorter' ? 'reading.compareShorter' : 'reading.compareLonger', {
                prev: change.previousSec,
                cur: change.currentSec,
                diff: change.diffSec,
              });
        const now = playing?.lineId === row.lineId ? playing.which : null;
        return (
          <View key={row.lineId} style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={styles.role}>{line?.type === 'dialogue' ? line.role : ''}</Text>
              <Pressable
                style={styles.playBtn}
                onPress={() => void playBoth(row)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t('reading.comparePlay')}>
                <Feather name={now ? 'square' : 'play'} size={14} color={palette.blueDeep} />
                <Text style={styles.playText}>
                  {now === 'previous' ? t('reading.comparePrev') : now === 'current' ? t('reading.compareCur') : t('reading.comparePlay')}
                </Text>
              </Pressable>
            </View>
            <Text style={styles.text}>{line?.text ?? ''}</Text>
            <Text style={styles.change}>{changeText}</Text>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  content: { paddingHorizontal: space.gutter, paddingTop: space[2], paddingBottom: space[6], gap: space[3] },
  count: { ...type.captionBold, color: palette.blueDeep },
  note: { ...type.caption, color: palette.textMeta },
  card: { gap: space[2], backgroundColor: palette.bgSubtle, borderRadius: radius.lg, padding: space[4] },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2] },
  role: { ...type.captionBold, color: palette.text },
  text: { ...type.body1Bold, color: palette.text },
  change: { ...type.caption, color: palette.textSub },
  playBtn: { flexDirection: 'row', alignItems: 'center', gap: space[1], backgroundColor: palette.blueSoft, borderRadius: radius.full, height: 32, paddingHorizontal: space[3] },
  playText: { ...type.micro, color: palette.blueDeep },
});
