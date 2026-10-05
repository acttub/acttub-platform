import Feather from '@expo/vector-icons/Feather';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { useAppDialog } from '@/components/app-dialog';
import { DiffText } from '@/components/diff-text';
import { CHIP_TONE } from '@/lib/reading/script-cards';
import { scriptErrorMessage } from '@/lib/reading/script-errors';
import {
  isPlaybackExpired,
  practiceAgainParams,
  sessionChip,
  sessionDetailMeta,
  sessionLines,
  sessionProgress,
  sessionRangeTitle,
  shortTime,
  type SessionLine,
} from '@/lib/reading/session-cards';
import { deleteSession, fetchSession, getCurrent, setCurrentSession } from '@/lib/reading/store';
import type { SessionDetail, SessionRecording } from '@/lib/reading/types';
import { translate as t } from '@/lib/i18n';

type Tab = 'all' | 'mine';

/**
 * 회차 상세(R4.9~R4.16, reading.session · reading.recording). 구간·배역·날짜·길이·상태, [전체 듣기](내 녹음을 줄 순서로),
 * 「대본」 [구간 전체 | 내 녹음만](처음엔 늘 구간 전체). 녹음은 듣기만 한다.
 * 진행 중 → [이어서 연습 · K/N줄] → R9, 완료 → [이 구간으로 다시 연습] → R8(그 배역·구간이 골라진 채).
 * 재생 주소는 10분 서명이라 만료됐으면 회차를 다시 조회해 새 주소를 받는다.
 */
export default function ReadingSession() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { confirm, sheet, alert, dialog } = useAppDialog();
  const script = getCurrent();
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<Tab>('all');
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [listen, setListen] = useState<{ at: number; total: number } | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const mounted = useRef(true);
  /**
   * 재생 차례 번호. 새 재생·멈춤·화면 떠남마다 올린다 — 만료된 재생 주소를 다시 받는 동안 멈췄거나 떠났으면
   * 받은 뒤에 틀지도 실패를 알리지도 않는다.
   */
  const playRun = useRef(0);

  const rows = useMemo(() => (script && detail ? sessionLines(script, detail) : []), [script, detail]);
  const recorded = useMemo(() => rows.filter((r) => r.recording), [rows]);

  const stopPlayback = useCallback(() => {
    playRun.current += 1;
    try {
      playerRef.current?.remove();
    } catch {}
    playerRef.current = null;
    setPlayingId(null);
    setListen(null);
  }, []);

  const load = useCallback(async () => {
    if (!id) return null;
    setFailed(false);
    const next = await fetchSession(id);
    if (!mounted.current) return null;
    if (next) setDetail(next);
    else setFailed(true);
    return next;
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      mounted.current = true;
      void load();
      return () => {
        mounted.current = false;
        stopPlayback();
      };
    }, [load, stopPlayback]),
  );

  if (!script) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={styles.dim}>{t('reading.noScript')}</Text>
        <Pressable style={styles.pill} onPress={() => router.replace('/reading')}>
          <Text style={styles.pillText}>{t('reading.toMyScripts')}</Text>
        </Pressable>
      </View>
    );
  }

  if (!detail) {
    return (
      <View style={[styles.root, styles.center]}>
        {failed ? (
          <>
            <Text style={styles.dim}>{t('reading.sessionLoadFailed')}</Text>
            <Pressable style={styles.pill} onPress={() => void load()}>
              <Text style={styles.pillText}>{t('common.retry')}</Text>
            </Pressable>
          </>
        ) : (
          <ActivityIndicator color={palette.textFaint} />
        )}
      </View>
    );
  }

  const progress = sessionProgress(script, detail);
  const chip = sessionChip(detail.status, progress);
  const tone = CHIP_TONE[chip.tone];
  const playable = recorded.filter((r) => r.recording?.playback_url);

  const freshRecording = async (rec: SessionRecording): Promise<SessionRecording | null> => {
    if (!isPlaybackExpired(rec)) return rec;
    const next = await load();
    return next?.recordings.find((r) => r.id === rec.id) ?? null;
  };

  const playOne = async (rec: SessionRecording, onDone: () => void): Promise<'playing' | 'failed' | 'stale'> => {
    const run = ++playRun.current;
    const fresh = await freshRecording(rec);
    if (run !== playRun.current) return 'stale';
    if (!fresh?.playback_url) return 'failed';
    try {
      playerRef.current?.remove();
    } catch {}
    const player = createAudioPlayer({ uri: fresh.playback_url });
    playerRef.current = player;
    player.addListener('playbackStatusUpdate', (status) => {
      if (status.didJustFinish && playerRef.current === player) onDone();
    });
    player.play();
    setPlayingId(fresh.id);
    return 'playing';
  };

  const playbackFailed = () => {
    stopPlayback();
    void load();
    void alert({ title: t('reading.listenAll'), message: t('reading.playbackFailed') });
  };

  const togglePlay = async (rec: SessionRecording) => {
    if (playingId === rec.id) {
      stopPlayback();
      return;
    }
    stopPlayback();
    if ((await playOne(rec, stopPlayback)) === 'failed') playbackFailed();
  };

  const listenAll = async () => {
    if (listen) {
      stopPlayback();
      return;
    }
    const queue = playable.map((r) => r.recording as SessionRecording);
    const playAt = async (at: number) => {
      if (at >= queue.length || !mounted.current) {
        stopPlayback();
        return;
      }
      setListen({ at: at + 1, total: queue.length });
      if ((await playOne(queue[at], () => void playAt(at + 1))) === 'failed') playbackFailed();
    };
    await playAt(0);
  };

  const more = () =>
    void sheet({
      title: t('reading.sessionOrdinal', { n: detail.ordinal }),
      actions: [{ label: t('reading.deleteSession'), destructive: true, onPress: () => void removeSession() }],
    });

  const removeSession = async () => {
    const ok = await confirm({
      title: t('reading.deleteSessionTitle'),
      message: t('reading.deleteSessionBody'),
      confirmLabel: t('common.delete'),
      destructive: true,
    });
    if (!ok) return;
    try {
      stopPlayback();
      await deleteSession(detail.id);
      router.back();
    } catch (e) {
      void alert({ title: t('reading.deleteSession'), message: scriptErrorMessage(e) });
    }
  };

  const resume = () => {
    setCurrentSession(detail);
    router.push('/reading/play');
  };

  const playButton = (rec: SessionRecording) => {
    const playing = playingId === rec.id;
    return (
      <Pressable
        style={[styles.playBtn, playing && styles.playBtnOn]}
        hitSlop={6}
        accessibilityLabel={playing ? t('reading.nowPlaying') : t('reading.listenAll')}
        onPress={() => void togglePlay(rec)}
      >
        <Feather name={playing ? 'pause' : 'play'} size={14} color={playing ? palette.onAccent : palette.blue} />
      </Pressable>
    );
  };

  const scriptRow = (row: SessionLine) => {
    if (row.type !== 'dialogue') {
      return (
        <Text key={row.lineId} style={row.type === 'scene' ? styles.scene : styles.direction}>
          {row.text}
        </Text>
      );
    }
    return (
      <View key={row.lineId} style={styles.line}>
        <View style={styles.lineBody}>
          <View style={styles.roleRow}>
            <Text style={[styles.role, row.mine && styles.roleMine]}>{row.role}</Text>
            {row.resumeHere && (
              <View style={styles.resumeTag}>
                <Text style={styles.resumeTagText}>{t('reading.resumeHere')}</Text>
              </View>
            )}
          </View>
          <DiffText target={row.text} said={row.said} />
        </View>
        {row.recording && playButton(row.recording)}
      </View>
    );
  };

  const recordingRow = (row: SessionLine) => {
    const rec = row.recording as SessionRecording;
    const playing = playingId === rec.id;
    const label = [row.dialogueNo !== null ? t('reading.lineNo', { n: row.dialogueNo }) : null, shortTime(rec.duration_ms / 1000), playing ? t('reading.nowPlaying') : null]
      .filter(Boolean)
      .join(' · ');
    return (
      <View key={row.lineId} style={styles.line}>
        {playButton(rec)}
        <View style={styles.lineBody}>
          <Text style={[styles.recLabel, playing && styles.recLabelOn]}>{label}</Text>
          <DiffText target={row.text} said={row.said} />
        </View>
      </View>
    );
  };

  return (
    <View style={styles.root}>
      <Stack.Screen
        options={{
          title: t('reading.sessionOrdinal', { n: detail.ordinal }),
          headerShadowVisible: false,
          headerRight: () => (
            <Pressable hitSlop={8} accessibilityLabel={t('reading.more')} onPress={more}>
              <Feather name="more-horizontal" size={22} color={palette.text} />
            </Pressable>
          ),
        }}
      />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]}>
        <View style={styles.head}>
          <Text style={styles.title}>{sessionRangeTitle(script.lines, detail)}</Text>
          <View style={styles.metaRow}>
            <Text style={styles.meta}>{sessionDetailMeta(detail)}</Text>
            <View style={[styles.chip, { backgroundColor: tone.bg }]}>
              <Text style={[styles.chipText, { color: tone.color }]}>{chip.label}</Text>
            </View>
          </View>
          {playable.length > 0 && (
            <Pressable style={styles.listenAll} onPress={() => void listenAll()}>
              <Feather name={listen ? 'pause' : 'play'} size={16} color={palette.blueDeep} />
              <Text style={styles.listenAllText}>{listen ? t('reading.stopListening', { k: listen.at, n: listen.total }) : t('reading.listenAll')}</Text>
            </Pressable>
          )}
        </View>

        <Text style={styles.sectionTitle}>{t('reading.sessionScript')}</Text>
        <View style={styles.tabs}>
          {(['all', 'mine'] as const).map((key) => (
            <Pressable key={key} style={[styles.tab, tab === key && styles.tabOn]} onPress={() => setTab(key)}>
              <Text style={[styles.tabText, tab === key && styles.tabTextOn]}>
                {key === 'all' ? t('reading.rangeWhole') : t('reading.myRecordingsOnly')}
              </Text>
            </Pressable>
          ))}
        </View>

        {tab === 'all' ? (
          rows.map(scriptRow)
        ) : recorded.length === 0 ? (
          <View style={styles.empty}>
            <Feather name="mic-off" size={26} color={palette.textFaint} />
            <Text style={styles.emptyTitle}>{t('reading.noRecordings')}</Text>
            <Text style={styles.emptyHint}>{t('reading.noRecordingsHint')}</Text>
          </View>
        ) : (
          recorded.map(recordingRow)
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        {progress ? (
          <Pressable style={styles.primary} onPress={resume}>
            <Feather name="play" size={16} color={palette.onAccent} />
            <Text style={styles.primaryText}>{t('reading.resumeSession', progress)}</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.primary} onPress={() => router.push({ pathname: '/reading/range', params: practiceAgainParams(detail) })}>
            <Feather name="rotate-ccw" size={16} color={palette.onAccent} />
            <Text style={styles.primaryText}>{t('reading.practiceRangeAgain')}</Text>
          </Pressable>
        )}
      </View>
      {dialog}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  dim: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 15 },
  content: { paddingHorizontal: 20, paddingTop: 8 },
  head: { gap: 10, paddingBottom: 20, borderBottomColor: palette.border, borderBottomWidth: 1 },
  title: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 24 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  meta: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 13 },
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { fontFamily: 'Pretendard-SemiBold', fontSize: 12 },
  listenAll: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10, borderRadius: 12, paddingVertical: 15, backgroundColor: palette.blueSoft },
  listenAllText: { color: palette.blueDeep, fontFamily: 'Pretendard-Bold', fontSize: 15 },
  sectionTitle: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 16, marginTop: 20, marginBottom: 10 },
  tabs: { flexDirection: 'row', padding: 3, borderRadius: 10, backgroundColor: palette.bgSoft, marginBottom: 6 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 8 },
  tabOn: { backgroundColor: palette.bg },
  tabText: { color: palette.textMuted, fontFamily: 'Pretendard-SemiBold', fontSize: 14 },
  tabTextOn: { color: palette.text, fontFamily: 'Pretendard-Bold' },
  line: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomColor: palette.borderSoft, borderBottomWidth: 1 },
  lineBody: { flex: 1, gap: 4 },
  roleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  role: { color: palette.textDim, fontFamily: 'Pretendard-Bold', fontSize: 13 },
  roleMine: { color: palette.blue },
  resumeTag: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: palette.blueSoft },
  resumeTagText: { color: palette.blueDeep, fontFamily: 'Pretendard-SemiBold', fontSize: 11 },
  direction: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 14, fontStyle: 'italic', lineHeight: 21, paddingVertical: 14 },
  scene: { color: palette.textDim, fontFamily: 'Pretendard-Bold', fontSize: 15, paddingVertical: 14 },
  recLabel: { color: palette.textFaint, fontFamily: 'Pretendard-SemiBold', fontSize: 11 },
  recLabelOn: { color: palette.blue },
  playBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: palette.blueSoft, alignItems: 'center', justifyContent: 'center' },
  playBtnOn: { backgroundColor: palette.blue },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 44 },
  emptyTitle: { color: palette.textDim, fontFamily: 'Pretendard-Bold', fontSize: 15 },
  emptyHint: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 13, textAlign: 'center' },
  footer: { paddingHorizontal: 16, paddingTop: 12, borderTopColor: palette.borderSoft, borderTopWidth: 1, backgroundColor: palette.bg },
  primary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, paddingVertical: 15, backgroundColor: palette.blue },
  primaryText: { color: palette.onAccent, fontFamily: 'Pretendard-Bold', fontSize: 16 },
  pill: { backgroundColor: palette.blue, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 11 },
  pillText: { color: palette.onAccent, fontFamily: 'Pretendard-SemiBold', fontSize: 14 },
});
