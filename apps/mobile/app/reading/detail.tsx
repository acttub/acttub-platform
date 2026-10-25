import Feather from '@expo/vector-icons/Feather';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { PrimaryButton } from '@/components/ui/buttons';
import { useAppDialog } from '@/components/app-dialog';
import { TitleEditDialog } from '@/components/title-edit-dialog';
import { leavingSavesSettled } from '@/lib/reading/progress-queue';
import { CHIP_TONE, relativeDay } from '@/lib/reading/script-cards';
import { scriptErrorMessage } from '@/lib/reading/script-errors';
import { sessionCardMeta, sessionChip } from '@/lib/reading/session-cards';
import { rangeTitle } from '@/lib/reading/session-plan';
import { deleteScript, deleteSession, getCurrent, listSessions, loadIntoCurrent, type SavedScript } from '@/lib/reading/store';
import type { SessionCard } from '@/lib/reading/types';
import { translate as t } from '@/lib/i18n';
import type { GestureResponderEvent } from 'react-native';

import { pt } from '@/components/ui/anchored-menu';
import { SkeletonRows } from '@/components/ui/skeleton';

/**
 * 대본 상세(R4.1~R4.8, reading.session). 제목·대사 수·「대본 보기」·연습 기록(최근순, 줄마다 회차·구간·배역·상태)·[연습하기].
 * 회차 줄을 누르면 회차 상세, 왼쪽으로 밀면 [삭제]. 머리 ⋯ 는 제목 수정·목소리 바꾸기·대본 삭제.
 */
export default function ReadingDetail() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { confirm, sheet, alert, dialog } = useAppDialog();
  const [script, setScript] = useState<SavedScript | null>(getCurrent());
  const [sessions, setSessions] = useState<SessionCard[] | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    const id = getCurrent()?.id;
    if (!id) return;
    const s = await loadIntoCurrent(id);
    if (!mounted.current) return;
    setScript(s ? { ...s } : null);
    if (!s) return;
    const settling = leavingSavesSettled();
    const list = await listSessions(s.id).catch(() => []);
    if (!mounted.current) return;
    setSessions(list);
    // 리딩에서 바로 나왔으면 마지막 위치 저장(또는 [시작] 전 회차 지우기)이 아직 가는 중일 수 있다 — 다 가면 한 번 더 불러온다.
    if (!settling) return;
    await settling;
    if (!mounted.current) return;
    const fresh = await listSessions(s.id).catch(() => null);
    if (fresh && mounted.current) setSessions(fresh);
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

  const more = (e?: GestureResponderEvent) =>
    void sheet({
      anchor: pt(e),
      title: script.title,
      actions: [
        { label: t('reading.editAction'), icon: 'edit-2', onPress: () => setEditingTitle(true) },
        { label: t('reading.changeVoices'), onPress: () => router.push('/reading/roles') },
        { label: t('reading.deleteAction'), icon: 'trash-2', destructive: true, onPress: () => void removeScript() },
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
            <Pressable hitSlop={8} accessibilityRole="button" accessibilityLabel={t('reading.more')} ph-label="reading_detail_more" onPress={more}>
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
            <Feather name="chevron-right" size={14} color={palette.blueDeep} />
          </Pressable>
        </View>

        <Text style={styles.sectionTitle}>{t('reading.sessionsTitle')}</Text>

        {sessions === null ? (
          <SkeletonRows count={3} />
        ) : sessions.length === 0 ? (
          <View style={styles.empty}>
            <Feather name="mic" size={24} color={palette.textFaint} />
            <Text style={styles.emptyTitle}>{t('reading.noSessions')}</Text>
            <Text style={styles.emptyHint}>{t('reading.noSessionsHint')}</Text>
          </View>
        ) : (
          sessions.map((card) => (
            <SessionRow
              key={card.id}
              card={card}
              onOpen={() => router.push({ pathname: '/reading/session', params: { id: card.id } })}
              onDelete={() => void removeSession(card)}
            />
          ))
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <PrimaryButton
          label={t('reading.practice')}
          icon={<Feather name="play" size={16} color={palette.onAccent} />}
          onPress={() => router.push('/reading/range')}
        />
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

function SessionRow({ card, onOpen, onDelete }: { card: SessionCard; onOpen: () => void; onDelete: () => void }) {
  const swipe = useRef<SwipeableMethods | null>(null);
  const chip = sessionChip(card.status, card.progress);
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
          <Text style={styles.rowRange} numberOfLines={1}>{rangeTitle(card.range_name, t)}</Text>
          <Text style={styles.rowSub} numberOfLines={1}>{sessionCardMeta(card)}</Text>
        </View>
        <View style={[styles.chip, { backgroundColor: tone.bg }]}>
          <Text style={[styles.chipText, { color: tone.color }]}>{chip.label}</Text>
        </View>
        <Feather name="chevron-right" size={16} color={palette.textFaint} />
      </Pressable>
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  dim: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 15 },
  content: { paddingHorizontal: 20, paddingTop: 4 },
  head: { gap: 5, paddingBottom: 20 },
  title: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 24 },
  meta: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 13 },
  viewScript: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', paddingTop: 6 },
  viewScriptText: { color: palette.blueDeep, fontFamily: 'Pretendard-SemiBold', fontSize: 13.5 },
  // pen 「SecHead」 — 위 칸과 옅은 선으로 나눈다.
  sectionTitle: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 16, paddingTop: 18, paddingBottom: 4, borderTopColor: palette.borderSoft, borderTopWidth: 1 },
  loading: { paddingVertical: 40 },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 44 },
  emptyTitle: { color: palette.textDim, fontFamily: 'Pretendard-SemiBold', fontSize: 14.5 },
  emptyHint: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 12.5, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    backgroundColor: palette.bg,
    borderBottomColor: palette.border,
    borderBottomWidth: 1,
  },
  rowLeft: { width: 62, gap: 2 },
  rowOrdinal: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 15 },
  rowBody: { flex: 1, gap: 2 },
  rowRange: { color: palette.text, fontFamily: 'Pretendard-SemiBold', fontSize: 14 },
  rowSub: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 12 },
  chip: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  chipText: { fontFamily: 'Pretendard-SemiBold', fontSize: 11.5 },
  swipeDelete: { width: 84, alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: palette.danger },
  swipeDeleteText: { color: palette.onAccent, fontFamily: 'Pretendard-Bold', fontSize: 13 },
  footer: { paddingHorizontal: 16, paddingTop: 12, borderTopColor: palette.borderSoft, borderTopWidth: 1, backgroundColor: palette.bg },
  primary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, paddingVertical: 15, backgroundColor: palette.blue },
  primaryText: { color: palette.onAccent, fontFamily: 'Pretendard-Bold', fontSize: 16 },
  pill: { backgroundColor: palette.blue, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 11 },
  pillText: { color: palette.onAccent, fontFamily: 'Pretendard-SemiBold', fontSize: 14 },
});
