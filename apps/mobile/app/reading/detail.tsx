import Feather from '@expo/vector-icons/Feather';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { ReadingNoScript } from '@/components/reading/no-script';
import { PrimaryButton } from '@/components/ui/buttons';
import { CtaBar } from '@/components/ui/cta-bar';
import { InlineEmpty } from '@/components/ui/inline-empty';
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

  if (!script) return <ReadingNoScript />;

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
      router.dismissTo('/reading');
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
        { label: t('reading.changeVoices'), icon: 'volume-2', onPress: () => router.push('/reading/roles') },
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
            <Pressable style={styles.moreBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('reading.more')} ph-label="reading_detail_more" onPress={more}>
              <Feather name="more-horizontal" size={22} color={palette.text} />
            </Pressable>
          ),
        }}
      />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
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
          <InlineEmpty title={t('reading.noSessions')} description={t('reading.noSessionsHint')} />
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

      <CtaBar>
        <PrimaryButton
          label={t('reading.practice')}
          icon={<Feather name="play" size={16} color={palette.onAccent} />}
          onPress={() => router.push('/reading/range')}
        />
      </CtaBar>
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
        <Feather name="chevron-right" size={18} color={palette.iconFaint} />
      </Pressable>
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  scroll: { flex: 1 },
  content: { paddingHorizontal: space.gutter, paddingTop: space[1], paddingBottom: space[6] },
  moreBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  head: { gap: space[1], paddingBottom: space[5] },
  title: { ...type.title1, color: palette.text },
  meta: { ...type.caption, color: palette.textMeta },
  viewScript: { flexDirection: 'row', alignItems: 'center', gap: space[1], alignSelf: 'flex-start', paddingTop: space[1] },
  viewScriptText: { ...type.captionBold, color: palette.blueDeep },
  sectionTitle: { ...type.headline, color: palette.text, paddingTop: space[4], paddingBottom: space[2], borderTopColor: palette.border, borderTopWidth: 1 },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingVertical: space[3],
    backgroundColor: palette.bg,
    borderBottomColor: palette.border,
    borderBottomWidth: 1,
  },
  rowLeft: { width: 56, gap: space[1] },
  rowOrdinal: { ...type.body2Bold, color: palette.text },
  rowBody: { flex: 1, gap: space[1] },
  rowRange: { ...type.body2Bold, color: palette.text },
  rowSub: { ...type.caption, color: palette.textMeta },
  chip: { borderRadius: radius.full, paddingHorizontal: space[2], paddingVertical: space[1] },
  chipText: type.micro,
  swipeDelete: { width: 84, alignItems: 'center', justifyContent: 'center', gap: space[1], backgroundColor: palette.danger },
  swipeDeleteText: { ...type.captionBold, color: palette.onAccent },
});
