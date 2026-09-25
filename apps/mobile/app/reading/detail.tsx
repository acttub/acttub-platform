import Feather from '@expo/vector-icons/Feather';
import { useFocusEffect, useRouter } from 'expo-router';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { useAppDialog } from '@/components/app-dialog';
import { statusChip } from '@/lib/reading/script-cards';
import { scriptErrorMessage } from '@/lib/reading/script-errors';
import {
  isPlaybackExpired,
  listenQueue,
  recordingSummary,
  recordingsInLineOrder,
  resumeProgress,
  sessionCardTitle,
  sessionStatusLabel,
  shortTime,
} from '@/lib/reading/session-cards';
import { dialogueNumbers } from '@/lib/reading/session-plan';
import {
  deleteRecording,
  deleteScript,
  deleteSession,
  fetchSession,
  getCurrent,
  listSessions,
  loadIntoCurrent,
  setCurrentSession,
  type SavedScript,
} from '@/lib/reading/store';
import type { SessionCard, SessionDetail, SessionRecording } from '@/lib/reading/types';
import { translate as t } from '@/lib/i18n';

/**
 * 대본 상세(R00.5, reading.session · reading.recording). 서버 회차 목록(최근순)과 회차마다
 * "내 대사 N개 중 K개 녹음 · mm:ss · P%", 펼치면 줄 순서의 녹음(원문·길이·재생·전사), "이어 듣기"(내 대사 녹음을
 * 순서대로), 개별 녹음 삭제, 회차 삭제. 열린 회차가 있으면 "이어서 연습 · K / N", 아니면 "새로운 연습".
 * 재생 주소는 10분 서명이라 만료됐으면 회차를 다시 조회해 새 주소를 받는다.
 */
const CHIP_TONE = {
  reading: { color: palette.blue, bg: palette.blueSoft },
  completed: { color: palette.green, bg: palette.greenSoft },
  no_cast: { color: palette.textDim, bg: palette.bgSoft },
} as const;

export default function ReadingDetail() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { confirm, sheet, alert, dialog } = useAppDialog();
  const [script, setScript] = useState<SavedScript | null>(getCurrent());
  const [sessions, setSessions] = useState<SessionCard[] | null>(null);
  const [openSession, setOpenSession] = useState<SessionDetail | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<SessionDetail | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [listeningAll, setListeningAll] = useState(false);
  const playerRef = useRef<AudioPlayer | null>(null);
  const listenRef = useRef<SessionRecording[]>([]);
  const mounted = useRef(true);

  const numbers = useMemo(() => (script ? dialogueNumbers(script.lines) : []), [script]);
  const lineIndex = useMemo(() => new Map((script?.lineIds ?? []).map((id, i) => [id, i] as const)), [script]);

  const stopPlayback = useCallback(() => {
    try {
      playerRef.current?.remove();
    } catch {}
    playerRef.current = null;
    listenRef.current = [];
    setPlayingId(null);
    setListeningAll(false);
  }, []);

  const load = useCallback(async () => {
    const id = getCurrent()?.id;
    if (!id) return;
    const s = await loadIntoCurrent(id);
    if (!mounted.current) return;
    setScript(s ? { ...s } : null);
    if (!s) return;
    const [list, open] = await Promise.all([listSessions(s.id).catch(() => []), s.openSessionId ? fetchSession(s.openSessionId) : Promise.resolve(null)]);
    if (!mounted.current) return;
    setSessions(list);
    setOpenSession(open);
  }, []);

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
  useEffect(() => () => stopPlayback(), [stopPlayback]);

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

  const chip = statusChip({ status: openSession ? 'reading' : script.lastSession?.status === 'completed' ? 'completed' : 'no_cast' });
  const tone = CHIP_TONE[chip.tone];
  const myRoles = script.lastSession?.my_character_names ?? script.myRoles;

  // ── 회차 시작·이어하기 ──────────────────────────────────────────────────────
  const startFresh = () => router.push('/reading/roles');
  const resume = () => {
    if (!openSession) return;
    setCurrentSession(openSession);
    router.push('/reading/play');
  };
  const currentDialogueNo = openSession?.current_line_id ? (numbers[lineIndex.get(openSession.current_line_id) ?? -1] ?? null) : null;
  const openProgress = openSession ? resumeProgress(openSession, currentDialogueNo) : null;

  // ── 더보기(R00.3·R00.4) ────────────────────────────────────────────────────
  const removeScript = async () => {
    const ok = await confirm({
      title: t('reading.deleteTitle'),
      message: script.recordingCount > 0 ? t('reading.deleteBody', { recordings: script.recordingCount }) : t('reading.deleteBodyNoRecordings'),
      confirmLabel: t('common.delete'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteScript(script.id);
      router.replace('/reading');
    } catch (e) {
      void alert({ title: t('reading.deleteAction'), message: scriptErrorMessage(e) });
    }
  };
  const more = () =>
    void sheet({
      title: script.title,
      actions: [
        { label: t('reading.editAction'), onPress: () => router.push('/reading/edit') },
        { label: t('reading.deleteAction'), destructive: true, onPress: () => void removeScript() },
      ],
    });

  // ── 회차 펼치기·재생·삭제 ───────────────────────────────────────────────────
  const toggleExpand = async (id: string) => {
    stopPlayback();
    if (expandedId === id) {
      setExpandedId(null);
      setExpanded(null);
      return;
    }
    setExpandedId(id);
    setExpanded(null);
    const detail = await fetchSession(id);
    if (mounted.current) setExpanded(detail);
  };

  /** 만료된 주소면 회차를 다시 조회해 새 주소를 받는다. */
  const freshRecording = async (rec: SessionRecording): Promise<SessionRecording | null> => {
    if (!isPlaybackExpired(rec)) return rec;
    if (!expandedId) return null;
    const detail = await fetchSession(expandedId);
    if (!detail) return null;
    if (mounted.current) setExpanded(detail);
    return detail.recordings.find((r) => r.id === rec.id) ?? null;
  };

  const playOne = async (rec: SessionRecording, onDone?: () => void): Promise<boolean> => {
    const fresh = await freshRecording(rec);
    if (!fresh?.playback_url) return false;
    try {
      playerRef.current?.remove();
    } catch {}
    const player = createAudioPlayer({ uri: fresh.playback_url });
    playerRef.current = player;
    player.addListener('playbackStatusUpdate', (status) => {
      if (status.didJustFinish && playerRef.current === player) {
        if (onDone) onDone();
        else {
          setPlayingId(null);
        }
      }
    });
    player.play();
    setPlayingId(fresh.id);
    return true;
  };

  const togglePlay = async (rec: SessionRecording) => {
    if (playingId === rec.id) {
      stopPlayback();
      return;
    }
    setListeningAll(false);
    listenRef.current = [];
    const ok = await playOne(rec);
    if (!ok) void alert({ title: t('reading.listenAll'), message: t('reading.playbackFailed') });
  };

  const listenAll = async () => {
    if (!expanded) return;
    if (listeningAll) {
      stopPlayback();
      return;
    }
    const queue = listenQueue(expanded, script.lineIds);
    if (queue.length === 0) return;
    listenRef.current = queue.slice(1);
    setListeningAll(true);
    const next = async () => {
      const [head, ...rest] = listenRef.current;
      if (!head || !mounted.current) {
        stopPlayback();
        return;
      }
      listenRef.current = rest;
      const ok = await playOne(head, () => void next());
      if (!ok) void next();
    };
    const ok = await playOne(queue[0], () => void next());
    if (!ok) void next();
  };

  const removeRecording = async (rec: SessionRecording) => {
    const ok = await confirm({ title: t('reading.deleteRecordingTitle'), message: t('reading.deleteRecordingBody'), confirmLabel: t('common.delete'), destructive: true });
    if (!ok) return;
    try {
      await deleteRecording(rec.id);
      if (expandedId) setExpanded(await fetchSession(expandedId));
      void load();
    } catch (e) {
      void alert({ title: t('reading.deleteRecording'), message: scriptErrorMessage(e) });
    }
  };

  const removeSession = async (card: SessionCard) => {
    const ok = await confirm({ title: t('reading.deleteSessionTitle'), message: t('reading.deleteSessionBody'), confirmLabel: t('common.delete'), destructive: true });
    if (!ok) return;
    try {
      stopPlayback();
      await deleteSession(card.id);
      if (expandedId === card.id) {
        setExpandedId(null);
        setExpanded(null);
      }
      void load();
    } catch (e) {
      void alert({ title: t('reading.deleteSession'), message: scriptErrorMessage(e) });
    }
  };

  const lineText = (lineId: string) => {
    const idx = lineIndex.get(lineId);
    const line = idx === undefined ? undefined : script.lines[idx];
    return { no: idx === undefined ? null : numbers[idx], text: line?.text ?? '' };
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]}>
        {/* 대본 요약 */}
        <View style={styles.summary}>
          <View style={styles.sumIcon}>
            <Feather name="file-text" size={20} color={palette.blue} />
          </View>
          <View style={styles.sumBody}>
            <Text style={styles.sumRole}>내 배역 · {myRoles.join(', ') || t('reading.unset')}</Text>
            <Text style={styles.sumMeta}>
              {script.dialogueCount}개 대사 · 녹음 {script.recordingCount}개 · {t('reading.sessionOrdinal', { n: sessions?.length ?? 0 })}
            </Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${openProgress && openProgress.n ? Math.round((openProgress.k / openProgress.n) * 100) : 0}%`, backgroundColor: tone.color }]} />
            </View>
          </View>
          <View style={styles.sumRight}>
            <View style={[styles.pillChip, { backgroundColor: tone.bg }]}>
              <Text style={[styles.pillChipText, { color: tone.color }]}>{chip.label}</Text>
            </View>
            <Pressable style={styles.moreBtn} hitSlop={8} accessibilityLabel={t('reading.more')} onPress={more}>
              <Feather name="more-horizontal" size={18} color={palette.textDim} />
            </Pressable>
          </View>
        </View>

        <Pressable style={styles.fullBtn} onPress={() => router.push('/reading/full')}>
          <View>
            <Text style={styles.fullTitle}>대본 전체보기</Text>
            <Text style={styles.fullSub}>{script.title}</Text>
          </View>
          <Feather name="chevron-right" size={20} color={palette.textFaint} />
        </Pressable>

        <View style={styles.recHead}>
          <Text style={styles.recTitle}>{t('reading.sessionsTitle')}</Text>
          <Text style={styles.recCount}>{sessions ? t('reading.sessionOrdinal', { n: sessions.length }) : ''}</Text>
        </View>

        {sessions === null ? (
          <ActivityIndicator color={palette.blue} style={{ paddingVertical: 24 }} />
        ) : sessions.length === 0 ? (
          <View style={styles.emptyRec}>
            <Feather name="mic" size={28} color={palette.checkOff} />
            <Text style={styles.emptyRecText}>{t('reading.noSessions')}</Text>
          </View>
        ) : (
          <View style={styles.recList}>
            {sessions.map((card, i) => {
              const isOpen = expandedId === card.id;
              const recs = expanded && isOpen ? recordingsInLineOrder(expanded, script.lineIds) : [];
              return (
                <View key={card.id} style={[styles.recCard, i === 0 && styles.recCardTop]}>
                  <Pressable style={styles.recRow} onPress={() => void toggleExpand(card.id)} onLongPress={() => void removeSession(card)}>
                    <View style={styles.recLeft}>
                      <Text style={styles.recRound}>{sessionCardTitle(card)}</Text>
                      {i === 0 && <View style={styles.latest}><Text style={styles.latestText}>{t('reading.sessionLatest')}</Text></View>}
                    </View>
                    <Text style={[styles.recStatus, card.status === 'in_progress' && styles.recStatusOpen]}>{sessionStatusLabel(card.status)}</Text>
                  </Pressable>
                  <Text style={styles.recMeta}>
                    {card.my_character_names.join(', ') || t('reading.noCast')} · {recordingSummary(card)}
                  </Text>
                  {isOpen && (
                    <View style={styles.expanded}>
                      {!expanded ? (
                        <ActivityIndicator color={palette.blue} />
                      ) : recs.length === 0 ? (
                        <Text style={styles.emptyRecText}>{t('reading.noRecordings')}</Text>
                      ) : (
                        <>
                          <Pressable style={[styles.listenAll, listeningAll && styles.listenAllOn]} onPress={() => void listenAll()}>
                            <Feather name={listeningAll ? 'square' : 'play'} size={14} color={listeningAll ? '#fff' : palette.blueDeep} />
                            <Text style={[styles.listenAllText, listeningAll && styles.listenAllTextOn]}>
                              {listeningAll ? t('reading.stopListening') : t('reading.listenAll')}
                            </Text>
                          </Pressable>
                          {recs.map((rec) => {
                            const { no, text } = lineText(rec.line_id);
                            const playing = playingId === rec.id;
                            return (
                              <View key={rec.id} style={styles.lineRow}>
                                <Pressable style={[styles.playBtn, playing && styles.playBtnOn]} onPress={() => void togglePlay(rec)}>
                                  <Feather name={playing ? 'pause' : 'play'} size={14} color={playing ? '#fff' : palette.blue} />
                                </Pressable>
                                <View style={styles.lineBody}>
                                  <Text style={styles.lineNo}>
                                    {no !== null ? t('reading.lineNo', { n: no }) : ''} · {shortTime(rec.duration_ms / 1000)}
                                  </Text>
                                  <Text style={styles.lineTextStyle} numberOfLines={2}>{text}</Text>
                                  {!!rec.transcript && (
                                    <Text style={styles.transcript} numberOfLines={2}>
                                      {t('reading.transcriptLabel')} · {rec.transcript}
                                    </Text>
                                  )}
                                </View>
                                <Pressable style={styles.trashBtn} hitSlop={6} accessibilityLabel={t('reading.deleteRecording')} onPress={() => void removeRecording(rec)}>
                                  <Feather name="trash-2" size={15} color={palette.textFaint} />
                                </Pressable>
                              </View>
                            );
                          })}
                        </>
                      )}
                      <Pressable style={styles.deleteSession} onPress={() => void removeSession(card)}>
                        <Feather name="trash-2" size={13} color={palette.danger} />
                        <Text style={styles.deleteSessionText}>{t('reading.deleteSession')}</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        {openSession && openProgress ? (
          <>
            <Pressable style={[styles.foot, styles.footGhost]} onPress={startFresh}>
              <Feather name="plus" size={16} color={palette.blue} />
              <Text style={styles.footGhostText}>{t('reading.newSession')}</Text>
            </Pressable>
            <Pressable style={[styles.foot, styles.footPrimary]} onPress={resume}>
              <Feather name="play" size={15} color="#fff" />
              <Text style={styles.footPrimaryText}>{t('reading.resumeSession', { k: openProgress.k, n: openProgress.n })}</Text>
            </Pressable>
          </>
        ) : (
          <Pressable style={[styles.foot, styles.footPrimary]} onPress={startFresh}>
            <Feather name="play" size={15} color="#fff" />
            <Text style={styles.footPrimaryText}>{t('reading.newSession')}</Text>
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
  content: { padding: 20, gap: 14 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: palette.card, borderColor: palette.border, borderWidth: 1, borderRadius: 16, padding: 16 },
  sumIcon: { width: 44, height: 44, borderRadius: 11, backgroundColor: palette.blueSoft, alignItems: 'center', justifyContent: 'center' },
  sumBody: { flex: 1, gap: 6 },
  sumRole: { color: palette.blueDeep, fontFamily: 'Pretendard-Bold', fontSize: 16 },
  sumMeta: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 12 },
  progressTrack: { height: 5, borderRadius: 3, backgroundColor: palette.bgSoft, overflow: 'hidden', marginTop: 2 },
  progressFill: { height: 5, borderRadius: 3 },
  sumRight: { alignItems: 'flex-end', gap: 4 },
  pillChip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  pillChipText: { fontFamily: 'Pretendard-SemiBold', fontSize: 12 },
  moreBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
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
  recLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  recRound: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 15 },
  latest: { backgroundColor: palette.blueSoft, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  latestText: { color: palette.blueDeep, fontFamily: 'Pretendard-SemiBold', fontSize: 11 },
  recStatus: { color: palette.textMuted, fontFamily: 'Pretendard-SemiBold', fontSize: 12 },
  recStatusOpen: { color: palette.blue },
  recMeta: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 12 },
  expanded: { gap: 10, borderTopColor: palette.borderSoft, borderTopWidth: 1, paddingTop: 10 },
  listenAll: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: palette.blueSoft, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  listenAllOn: { backgroundColor: palette.blue },
  listenAllText: { color: palette.blueDeep, fontFamily: 'Pretendard-SemiBold', fontSize: 13 },
  listenAllTextOn: { color: '#fff' },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  playBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: palette.blueSoft, alignItems: 'center', justifyContent: 'center' },
  playBtnOn: { backgroundColor: palette.blue },
  lineBody: { flex: 1, gap: 2 },
  lineNo: { color: palette.textFaint, fontFamily: 'Pretendard-SemiBold', fontSize: 11 },
  lineTextStyle: { color: palette.text, fontFamily: 'Pretendard', fontSize: 14, lineHeight: 20 },
  transcript: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 12, lineHeight: 17 },
  trashBtn: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  deleteSession: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-end', paddingVertical: 4 },
  deleteSessionText: { color: palette.danger, fontFamily: 'Pretendard-SemiBold', fontSize: 12 },
  footer: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 12, borderTopColor: palette.borderSoft, borderTopWidth: 1, backgroundColor: palette.bg },
  foot: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 12, paddingVertical: 15 },
  footGhost: { backgroundColor: palette.blueSoft },
  footGhostText: { color: palette.blueDeep, fontFamily: 'Pretendard-SemiBold', fontSize: 15 },
  footPrimary: { flex: 1.4, backgroundColor: palette.blue },
  footPrimaryText: { color: '#fff', fontFamily: 'Pretendard-Bold', fontSize: 15 },
  pill: { backgroundColor: palette.blue, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 11 },
  pillText: { color: '#fff', fontFamily: 'Pretendard-SemiBold', fontSize: 14 },
});
