import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { disposeAudioPlayer } from '@/lib/audio-dispose';
import { palette } from '@/constants/palette';
import { DiffText } from '@/components/diff-text';
import { ReadingNoScript } from '@/components/reading/no-script';
import { MASCOT } from '@/components/ui/mascot';
import { StatusScreen } from '@/components/ui/status-screen';
import { radius, space, type } from '@/constants/tokens';
import { latestRecordings } from '@/lib/reading/recording-plan';
import { onRecordingQueueChange } from '@/lib/reading/recording-runner';
import { isPlaybackExpired } from '@/lib/reading/session-cards';
import { directionLabel, flowRows } from '@/lib/reading/session-results';
import { fetchSession, getCurrent, getLastRunReview } from '@/lib/reading/store';
import type { SessionRecording } from '@/lib/reading/types';
import { translate as t } from '@/lib/i18n';

/**
 * 다르게 말한 대사 전체(R9.26, reading.session) — 완료 화면 「전체 보기」. 구간 대본을 위에서 아래로 보이고, 원문과
 * 다르게 말한 내 줄만 왼쪽 띠·노란 어절·아래 말한 것·[내 녹음]. 다르게 말한 줄은 완료 화면이 받은 서버 결과(store 의
 * RunReview — 완료 저장 응답, 그 응답을 잃어 409 였으면 회차 상세의 different_lines)이고, 녹음은 서버에 올라간 것만 들을 수 있다 — 올리기가 늦은 줄은 큐가 비는 대로 다시 조회해 버튼이 생긴다.
 */
export default function ReadingDiff() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const script = getCurrent();
  const review = getLastRunReview();
  const [recordings, setRecordings] = useState<SessionRecording[]>([]);
  const [playingLine, setPlayingLine] = useState<string | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const mounted = useRef(true);

  const latest = useMemo(() => latestRecordings(recordings), [recordings]);

  const rows = useMemo(() => {
    if (!script || !review) return [];
    return flowRows({ lines: script.lines, lineIds: script.lineIds, ...review });
  }, [script, review]);

  const load = useCallback(async (): Promise<SessionRecording[]> => {
    if (!review) return [];
    const detail = await fetchSession(review.sessionId);
    if (!detail) return [];
    if (mounted.current) setRecordings(detail.recordings);
    return detail.recordings;
  }, [review]);

  useEffect(() => {
    mounted.current = true;
    void load();
    const off = onRecordingQueueChange(() => void load());
    return () => {
      mounted.current = false;
      off();
      disposeAudioPlayer(playerRef.current);
      playerRef.current = null;
    };
  }, [load]);

  const stop = () => {
    disposeAudioPlayer(playerRef.current);
    playerRef.current = null;
    setPlayingLine(null);
  };

  const recordingOf = (lineId: string) => latest.get(lineId) ?? null;

  const play = async (lineId: string) => {
    if (playingLine === lineId) {
      stop();
      return;
    }
    let rec = recordingOf(lineId);
    if (!rec) return;
    // 재생 주소는 10분 서명이라 만료됐으면 회차를 다시 조회해 그 응답의 주소로 튼다.
    if (isPlaybackExpired(rec)) rec = latestRecordings(await load()).get(lineId) ?? null;
    if (!rec?.playback_url || !mounted.current) return;
    stop();
    const player = createAudioPlayer({ uri: rec.playback_url });
    playerRef.current = player;
    player.addListener('playbackStatusUpdate', (status) => {
      if (status.didJustFinish && playerRef.current === player && mounted.current) setPlayingLine(null);
    });
    player.play();
    setPlayingLine(lineId);
  };

  if (!script || !review) {
    return <ReadingNoScript />;
  }

  if (!rows.some((row) => row.different)) {
    // pen R9.47 — 다르게 말한 대사가 없을 때
    return <StatusScreen kind="empty" mascot={MASCOT.reading} title={t('reading.diffEmpty')} primary={{ label: t('reading.diffBack'), onPress: () => router.back() }} />;
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
      {/* pen R9.26(10/24 지성 스타일) — 위에 몇 줄을 다르게 말했는지, 다르게 말한 줄만 파란 테두리 카드. */}
      <Text style={styles.count}>{t('reading.diffCount', { count: rows.filter((row) => row.different).length })}</Text>
      {rows.map((row) => {
        if (row.line.type !== 'dialogue') {
          return <Text key={row.lineId} style={styles.direction}>{row.line.type === 'direction' ? directionLabel(row.line.text) : row.line.text}</Text>;
        }
        if (!row.different) {
          return (
            <View key={row.lineId} style={styles.row}>
              <Text style={[styles.role, row.mine && styles.roleMine]}>{row.line.role}</Text>
              <Text style={styles.text}>{row.line.text}</Text>
            </View>
          );
        }
        const rec = recordingOf(row.lineId);
        const playing = playingLine === row.lineId;
        return (
          <View key={row.lineId} style={[styles.row, styles.rowDifferent]}>
            <View style={styles.rowHead}>
              <Text style={styles.roleCard}>{row.line.role}</Text>
              {!!rec?.playback_url && (
                <Pressable style={styles.playBtn} onPress={() => void play(row.lineId)} hitSlop={8} accessibilityRole="button">
                  <Feather name={playing ? 'square' : 'play'} size={14} color={palette.blueDeep} />
                  <Text style={styles.playText}>{t('reading.myRecording')}</Text>
                </Pressable>
              )}
            </View>
            <DiffText text={row.line.text} different={row.different} textStyle={styles.textCard} saidLabel={t('reading.diffSaidLabel')} />
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
  direction: { ...type.caption, color: palette.textMeta },
  row: { gap: space[1], paddingHorizontal: space[1] },
  rowDifferent: { gap: space[2], backgroundColor: palette.bgSubtle, borderRadius: radius.lg, borderWidth: 1.5, borderColor: palette.blue, padding: space[4] },
  rowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2] },
  role: { ...type.micro, color: palette.textMeta },
  roleMine: { color: palette.blueDeep },
  roleCard: { ...type.captionBold, color: palette.text },
  text: { ...type.body2, color: palette.textSub },
  textCard: { ...type.body1Bold, color: palette.text },
  playBtn: { flexDirection: 'row', alignItems: 'center', gap: space[1], backgroundColor: palette.blueSoft, borderRadius: radius.full, height: 32, paddingHorizontal: space[3] },
  playText: { ...type.micro, color: palette.blueDeep },
});
