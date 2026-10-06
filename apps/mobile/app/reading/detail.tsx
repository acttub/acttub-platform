import Feather from '@expo/vector-icons/Feather';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { useAppDialog } from '@/components/app-dialog';
import { TitleEditDialog } from '@/components/title-edit-dialog';
import { CHIP_TONE, relativeDay } from '@/lib/reading/script-cards';
import { scriptErrorMessage } from '@/lib/reading/script-errors';
import { sessionCardMeta, sessionChip, sessionProgress, sessionRangeTitle } from '@/lib/reading/session-cards';
import { deleteScript, deleteSession, fetchSession, getCurrent, listSessions, loadIntoCurrent, type SavedScript } from '@/lib/reading/store';
import type { SessionCard } from '@/lib/reading/types';
import { translate as t } from '@/lib/i18n';

type Progress = { k: number; n: number };

/**
 * 대본 상세(R4.1~R4.8, reading.session). 제목·대사 수·「대본 보기」·연습 기록(최근순, 줄마다 회차·구간·배역·상태)·[연습하기].
 * 회차 줄을 누르면 회차 상세, 왼쪽으로 밀면 [삭제]. 머리 ⋯ 는 제목 수정·목소리 바꾸기·대본 삭제.
 * 목록 카드에는 진행 위치가 없어 진행 중 회차만 상세를 읽어 K/N 을 채운다.
 */
export default function ReadingDetail() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { confirm, sheet, alert, dialog } = useAppDialog();
  const [script, setScript] = useState<SavedScript | null>(getCurrent());
  const [sessions, setSessions] = useState<SessionCard[] | null>(null);
  const [progress, setProgress] = useState<Map<string, Progress>>(new Map());
  const [editingTitle, setEditingTitle] = useState(false);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    const id = getCurrent()?.id;
    if (!id) return;
    const s = await loadIntoCurrent(id);
    if (!mounted.current) return;
    setScript(s ? { ...s } : null);
    if (!s) return;
    const list = await listSessions(s.id).catch(() => []);
    if (!mounted.current) return;
    setSessions(list);
    const open = await Promise.all(list.filter((c) => c.status !== 'completed').map((c) => fetchSession(c.id)));
    if (!mounted.current) return;
    const next = new Map<string, Progress>();
    for (const d of open) {
      const p = d && sessionProgress(s, d);
      if (d && p) next.set(d.id, p);
    }
    setProgress(next);
  }, []);

  useFocusEffect(
    useCallback(() => {
      mounted.current = true;
      void load();
      return () => {
        mounted.current = false;
      };
    }, [load]),
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

  const removeScript = async () => {
    const ok = await confirm({
      title: t('reading.deleteTitle'),
      message: t('reading.deleteBody'),
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
        { label: t('reading.editAction'), onPress: () => setEditingTitle(true) },
        { label: t('reading.changeVoices'), onPress: () => router.push('/reading/roles') },
        { label: t('reading.deleteAction'), destructive: true, onPress: () => void removeScript() },
      ],
    });

  const removeSession = async (card: SessionCard) => {
    const ok = await confirm({
      title: t('reading.deleteSessionTitle'),
      message: t('reading.deleteSessionBody'),
      confirmLabel: t('common.delete'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteSession(card.id);
      void load();
    } catch (e) {
      void alert({ title: t('reading.deleteSession'), message: scriptErrorMessage(e) });
    }
  };

  return (
    <GestureHandlerRootView style={styles.root}>
      <Stack.Screen
        options={{
          title: '',
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
          <Text style={styles.title}>{script.title}</Text>
          <Text style={styles.meta}>{t('reading.dialogueTotal', { count: script.dialogueCount })}</Text>
          <Pressable style={styles.viewScript} hitSlop={6} onPress={() => router.push('/reading/full')}>
            <Text style={styles.viewScriptText}>{t('reading.viewScript')}</Text>
            <Feather name="chevron-right" size={16} color={palette.blue} />
          </Pressable>
        </View>

        <Text style={styles.sectionTitle}>{t('reading.sessionsTitle')}</Text>

        {sessions === null ? (
          <ActivityIndicator color={palette.textFaint} style={styles.loading} />
        ) : sessions.length === 0 ? (
          <View style={styles.empty}>
            <Feather name="mic" size={26} color={palette.textFaint} />
            <Text style={styles.emptyTitle}>{t('reading.noSessions')}</Text>
            <Text style={styles.emptyHint}>{t('reading.noSessionsHint')}</Text>
          </View>
        ) : (
          sessions.map((card) => (
            <SessionRow
              key={card.id}
              card={card}
              rangeTitle={sessionRangeTitle(script.lines, card)}
              progress={progress.get(card.id) ?? null}
              onOpen={() => router.push({ pathname: '/reading/session', params: { id: card.id } })}
              onDelete={() => void removeSession(card)}
            />
          ))
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Pressable style={styles.primary} onPress={() => router.push('/reading/range')}>
          <Feather name="play" size={16} color={palette.onAccent} />
          <Text style={styles.primaryText}>{t('reading.practice')}</Text>
        </Pressable>
      </View>
      {dialog}
      <TitleEditDialog
        script={editingTitle ? script : null}
        onClose={(saved) => {
          setEditingTitle(false);
          if (saved) setScript(getCurrent());
        }}
      />
    </GestureHandlerRootView>
  );
}

function SessionRow({
  card,
  rangeTitle,
  progress,
  onOpen,
  onDelete,
}: {
  card: SessionCard;
  rangeTitle: string;
  progress: Progress | null;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const swipe = useRef<SwipeableMethods | null>(null);
  const chip = sessionChip(card.status, progress);
  const tone = CHIP_TONE[chip.tone];
  return (
    <ReanimatedSwipeable
      ref={swipe}
      friction={2}
      rightThreshold={40}
      overshootRight={false}
      renderRightActions={() => (
        <Pressable
          style={styles.swipeDelete}
          onPress={() => {
            swipe.current?.close();
            onDelete();
          }}
        >
          <Feather name="trash-2" size={18} color={palette.onAccent} />
          <Text style={styles.swipeDeleteText}>{t('common.delete')}</Text>
        </Pressable>
      )}
    >
      <Pressable style={styles.row} onPress={onOpen}>
        <View style={styles.rowLeft}>
          <Text style={styles.rowOrdinal}>{t('reading.sessionOrdinal', { n: card.ordinal })}</Text>
          <Text style={styles.rowSub}>{relativeDay(card.started_at, Date.now())}</Text>
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.rowRange} numberOfLines={1}>{rangeTitle}</Text>
          <Text style={styles.rowSub} numberOfLines={1}>{sessionCardMeta(card)}</Text>
        </View>
        <View style={[styles.chip, { backgroundColor: tone.bg }]}>
          <Text style={[styles.chipText, { color: tone.color }]}>{chip.label}</Text>
        </View>
        <Feather name="chevron-right" size={18} color={palette.textFaint} />
      </Pressable>
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  dim: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 15 },
  content: { paddingHorizontal: 20, paddingTop: 8 },
  head: { gap: 6, paddingBottom: 20, borderBottomColor: palette.border, borderBottomWidth: 1 },
  title: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 24 },
  meta: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 13 },
  viewScript: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', marginTop: 6 },
  viewScriptText: { color: palette.blue, fontFamily: 'Pretendard-SemiBold', fontSize: 14 },
  sectionTitle: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 16, marginTop: 20, marginBottom: 6 },
  loading: { paddingVertical: 40 },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 44 },
  emptyTitle: { color: palette.textDim, fontFamily: 'Pretendard-Bold', fontSize: 15 },
  emptyHint: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 13, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    backgroundColor: palette.bg,
    borderBottomColor: palette.border,
    borderBottomWidth: 1,
  },
  rowLeft: { width: 62, gap: 3 },
  rowOrdinal: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 15 },
  rowBody: { flex: 1, gap: 3 },
  rowRange: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 15 },
  rowSub: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 12 },
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  chipText: { fontFamily: 'Pretendard-SemiBold', fontSize: 12 },
  swipeDelete: { width: 84, alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: palette.danger },
  swipeDeleteText: { color: palette.onAccent, fontFamily: 'Pretendard-Bold', fontSize: 13 },
  footer: { paddingHorizontal: 16, paddingTop: 12, borderTopColor: palette.borderSoft, borderTopWidth: 1, backgroundColor: palette.bg },
  primary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, paddingVertical: 15, backgroundColor: palette.blue },
  primaryText: { color: palette.onAccent, fontFamily: 'Pretendard-Bold', fontSize: 16 },
  pill: { backgroundColor: palette.blue, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 11 },
  pillText: { color: palette.onAccent, fontFamily: 'Pretendard-SemiBold', fontSize: 14 },
});
