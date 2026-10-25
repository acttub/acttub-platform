import Feather from '@expo/vector-icons/Feather';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Image } from 'expo-image';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
import { PracticeMenu, type PracticeMenuItem } from '@/components/ui/coach-practice-menu';
import { PrimaryButton } from '@/components/ui/buttons';
import { MASCOT, MASCOT_SIZE } from '@/components/ui/mascot';
import { RenameDialog } from '@/components/ui/coach-rename-dialog';
import { NavIconButton } from '@/components/ui/nav-header';
import { palette } from '@/constants/palette';
import { api } from '@/lib/api';
import { formatKoreanDate } from '@/lib/format';
import { PracticeVideoModal } from '@/components/practice-video-modal';
import { purgeVideoFileIfDue } from '@/lib/practice/upload-options';
import { forgetLocalCopy } from '@/lib/library/library-runner';
import { videoErrorMessage } from '@/lib/library/video-checks';
import { translate as t } from '@/lib/i18n';
import { groupTitle, roundSummary } from '@/lib/practice/groups';
import { orderedMessages } from '@/lib/practice/coach';
import { continueActionFor, continueActionLabel } from '@/lib/practice/resume';
import { setContinueOrigin } from '@/lib/practice/session-state';
import { PRACTICE_TITLE_MAX } from '@/lib/practice/start';
import { SpotlightGuide, type SpotlightStep } from '@/components/spotlight-guide';
import { useSpotlightTarget } from '@/hooks/use-spotlight-target';
import { hasSeenSpotlight, markSpotlightSeen } from '@/lib/guide-state';
import { TARGET } from '@/lib/spotlight-targets';
import type { CoachConversation, PracticeGroupDetail } from '@/lib/practice/types';
import { SkeletonRows } from '@/components/ui/skeleton';

/** 처음 한 번 비추는 자리 — 「다음 테이크 찍기」 버튼. */
const CONTINUE_STEPS: SpotlightStep[] = [{ target: TARGET.groupContinue, text: 'guide.spotContinue' }];

/**
 * A1.2 연습 기록 상세 — 묶음 하나.
 *
 * 묶음의 영상, 회차 흐름(n차 · 시각 · 대화 수 · 노트 제목 · 노트 보기), 마지막 대화와 이어 가는 버튼 하나를
 * 보여 준다(practice.library). 열린 테이크가 있으면 맨 위에 「대화 이어 가기」(그 대화로 바로), 없으면 아래에
 * 「다음 테이크 찍기」(새 영상을 골라 장면은 비운 채 시작)다(practice.resume, SOMA-672). 숨김은 묶음 전체이고
 * 영상은 보관함에 남는다.
 *
 * 머리 「⋯」는 pen 「추가 · 연습 ⋯ 메뉴」(SOMA-748)다 — 제목 바꾸기(묶음 제목 PATCH)와 영상까지 모두 지우기(파일만 파기).
 * 디자인의 「지난 테이크와 비교」·「이 테이크만 지우기」는 서버 기능(테이크 비교문·회차 삭제)이 없어 두지 않는다.
 */
export default function PracticeGroupScreen() {
  const router = useRouter();
  const { rootId } = useLocalSearchParams<{ rootId?: string }>();
  const { confirm, alert, dialog } = useAppDialog();
  const [group, setGroup] = useState<PracticeGroupDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [conversation, setConversation] = useState<CoachConversation | null>(null);
  const [conversationError, setConversationError] = useState<string | null>(null);
  const [, setConversationLoading] = useState(false);
  const conversationRequest = useRef(0);
  // P10.2 「연습 영상 보기」 — 묶음 영상의 재생 주소. 파기됐으면 purged.
  const [video, setVideo] = useState<{ url: string | null; purged: boolean } | null>(null);
  const [playing, setPlaying] = useState(false);
  // 지금 펼쳐 둔 대화의 id. 같은 줄을 다시 누르면 접는다(카드를 누르면 아래로 펼친다).
  const [openId, setOpenId] = useState<string | null>(null);
  // 같은 대화가 「마지막 대화」와 회차 카드의 「대화」 두 줄에 걸려 있어 둘 다 펼쳐지던 것을 막는다 — 누른 줄 아래에만 붙인다.
  const [openSlot, setOpenSlot] = useState<'last' | 'round' | null>(null);
  // 처음 한 번만 "이어서 연습할 수 있어요!"를 비춘다. 버튼이 목록 맨 아래라 먼저 내려 준다.
  // 대화 중인 묶음은 「다음 테이크 찍기」가 없으니 비추지 않는다(다음에 들어왔을 때 비춘다).
  const scrollRef = useRef<ScrollView>(null);
  const continueTarget = useSpotlightTarget(TARGET.groupContinue);
  const [guideOpen, setGuideOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);

  useEffect(() => {
    if (!group || group.in_progress_practice_id) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let alive = true;
    void hasSeenSpotlight('group').then((seen) => {
      if (seen || !alive) return;
      scrollRef.current?.scrollToEnd({ animated: false });
      timer = setTimeout(() => alive && setGuideOpen(true), 300);
    });
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [group]);

  const openConversation = async (id: string, slot: 'last' | 'round' = 'round') => {
    if (openId === id && openSlot !== slot) {
      // 이미 받은 대화를 다른 줄 아래로 옮기기만 한다.
      setOpenSlot(slot);
      return;
    }
    const request = ++conversationRequest.current;
    if (openId === id) {
      setOpenId(null);
      setOpenSlot(null);
      setConversation(null);
      setConversationError(null);
      setConversationLoading(false);
      return;
    }
    setOpenId(id);
    setOpenSlot(slot);
    setConversation(null);
    setConversationError(null);
    setConversationLoading(true);
    try {
      const loaded = await api.getConversation(id);
      if (request === conversationRequest.current) setConversation(loaded);
    } catch {
      if (request === conversationRequest.current) setConversationError(t('history.conversationLoadFail'));
    } finally {
      if (request === conversationRequest.current) setConversationLoading(false);
    }
  };

  const load = useCallback(async () => {
    if (!rootId) return;
    setError(null);
    try {
      setGroup(await api.getPracticeGroup(rootId));
    } catch {
      setError(t('history.groupLoadFail'));
    } finally {
      setLoading(false);
    }
  }, [rootId]);

  useEffect(() => {
    void load();
    return () => { conversationRequest.current += 1; };
  }, [load]);

  // 노트가 있는 회차는 분석이 끝난 것이다 — 「분석 끝나면 영상 바로 지우기」를 골랐다면 지우고 다시 읽는다.
  useEffect(() => {
    if (!group) return;
    let alive = true;
    void Promise.all(group.practices.filter((round) => round.note).map((round) => purgeVideoFileIfDue(round.id)))
      .then((done) => { if (alive && done.some(Boolean)) void load(); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [group, load]);

  // 묶음 영상의 재생 주소는 영상 상세에서만 준다.
  const groupVideoId = group?.video_id ?? null;
  useEffect(() => {
    setVideo(null);
    if (!groupVideoId) return;
    let alive = true;
    void Promise.resolve()
      .then(() => api.getVideo(groupVideoId))
      .then((v) => { if (alive) setVideo({ url: v.purged_at ? null : v.playback_url ?? null, purged: Boolean(v.purged_at) }); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [groupVideoId]);

  const action = continueActionFor(group);

  /** 열린 테이크의 대화로 바로 돌아간다 — 코치 화면이 단계를 보고 분석 중이면 기다렸다가 대화를 연다. */
  const resumeConversation = (practiceId: string) => {
    router.push({ pathname: '/coach', params: { practiceId } });
  };

  /** 같은 묶음의 다음 회차를 만든다. 영상은 새로 고르고 장면은 비운 채 시작한다. */
  const startNextTake = () => {
    if (!group) return;
    const last = group.practices[group.practices.length - 1];
    setContinueOrigin({ kind: 'group', rootId: group.root_id, practiceId: last?.id ?? group.root_id });
    router.push('/upload');
  };

  const toggleHidden = async ({ leave = false }: { leave?: boolean } = {}) => {
    if (!group) return;
    const hiding = !group.hidden_at;
    if (hiding) {
      const ok = await confirm({
        title: t('history.hideTitle'),
        message: t('history.hideNotice'),
        confirmLabel: t('history.hideConfirm'),
        destructive: true,
      });
      if (!ok) return;
    }
    try {
      const next = await api.patchPracticeGroup(group.root_id, { hidden: hiding });
      // 홈 「최근 연습」에서 들어와 지우는 길 — 숨기고 나면 목록으로 돌아간다(돌아간 화면은 포커스 때 다시 읽는다).
      if (hiding && leave && router.canGoBack()) {
        router.back();
        return;
      }
      setGroup(next);
    } catch (e) {
      await alert({
        title: t('history.deleteFailTitle'),
        message: e instanceof Error ? e.message : t('history.deleteFail'),
      });
    }
  };

  // 메뉴가 닫힌 뒤에 다음 창을 연다 — iOS 는 닫히는 모달 위에 새 창을 띄우지 못한다.
  const fromMenu = (action: () => void) => () => {
    setMenuOpen(false);
    setTimeout(action, Platform.OS === 'ios' ? 450 : 0);
  };

  const rename = async (title: string) => {
    if (!group) return;
    setGroup(await api.patchPracticeGroup(group.root_id, { title }));
  };

  /** 영상까지 지우기 — 회차·노트·대화는 남기고 영상 파일만 파기한다(practice.library 「파일만 파기」). */
  const purgeVideo = async () => {
    if (!group?.video_id) return;
    const ok = await confirm({
      title: t('history.purgeTitle'),
      message: t('history.purgeBody'),
      confirmLabel: t('history.purgeConfirm'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.purgeVideoFile(group.video_id);
      await forgetLocalCopy(group.video_id).catch(() => undefined);
      void alert({ title: t('history.purgeConfirm'), message: t('history.purgeDone') });
      void load();
    } catch (e) {
      void alert({ title: t('history.purgeConfirm'), message: videoErrorMessage(e) });
    }
  };

  const menuItems: PracticeMenuItem[] = [
    { key: 'rename', icon: 'edit-2', title: t('history.menuRename'), onPress: fromMenu(() => setRenameOpen(true)) },
    ...(group?.video_id
      ? [
          {
            key: 'purge',
            icon: 'trash-2' as const,
            title: t('history.menuPurge'),
            sub: t('history.menuPurgeSub'),
            danger: true,
            onPress: fromMenu(() => void purgeVideo()),
          },
        ]
      : []),
  ];

  const openNote = (practiceId: string) => {
    router.push({ pathname: '/report-detail', params: { practiceId } });
  };

  /** 펼친 대화 — 액티는 왼쪽 회색 말풍선(마스코트 머리), 나는 오른쪽 파란 말풍선. 대화 줄 바로 아래에 붙는다. */
  const renderOpen = (id: string, slot: 'last' | 'round' = 'round') => {
    if (openId !== id || openSlot !== slot) return null;
    return (
      <View key={`open-${id}`} style={styles.chat}>
        {conversationError && <Text style={styles.error}>{conversationError}</Text>}
        {conversation &&
          orderedMessages(conversation).map((message) =>
            message.role === 'coach' ? (
              <View key={message.turn_index} style={styles.coachRow}>
                <Image source={MASCOT.coach} style={MASCOT_SIZE.chat} contentFit="contain" accessibilityLabel={t('coach.roleCoach')} />
                <View style={styles.coachBubble}>
                  <Text style={styles.cardText}>{message.text}</Text>
                </View>
              </View>
            ) : (
              <View key={message.turn_index} style={styles.meBubble} accessibilityLabel={t('coach.roleMe')}>
                <Text style={styles.meText}>{message.text}</Text>
              </View>
            ),
          )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen
        options={{
          title: group ? groupTitle(group) : t('history.title'),
          headerShadowVisible: false,
          headerRight: () =>
            group && !group.hidden_at ? (
              <View style={styles.headerActions}>
                <NavIconButton
                  icon="more-horizontal"
                  color={palette.textMuted}
                  label={t('history.menuOpen')}
                  phLabel="practice_group_menu"
                  onPress={() => setMenuOpen(true)}
                />
                <NavIconButton
                  icon="trash-2"
                  size={20}
                  color={palette.textMuted}
                  label={t('history.hideConfirm')}
                  phLabel="practice_group_hide"
                  onPress={() => void toggleHidden({ leave: true })}
                />
              </View>
            ) : null,
        }}
      />
      {loading && <SkeletonRows count={4} avatar={false} />}
      {error && <Text style={styles.error}>{error}</Text>}
      {group && (
        <ScrollView ref={scrollRef} contentContainerStyle={styles.body}>
          <View style={styles.headRow}>
            <Text style={styles.title}>{groupTitle(group)}</Text>
            <Text style={styles.meta}>{t('history.countTimes', { count: group.ordinal_count })}</Text>
          </View>

          {/* 대화 중인 테이크가 있으면 그게 가장 먼저 할 일이다 — 맨 위 주 버튼(SOMA-672). */}
          {action.kind === 'resume' && (
            <PrimaryButton label={t(continueActionLabel(action))} onPress={() => resumeConversation(action.practiceId)} />
          )}

          {group.last_conversation_id && (
            <Pressable style={styles.round} onPress={() => void openConversation(group.last_conversation_id!, 'last')} accessibilityRole="button">
              <Text style={styles.openNote}>{t('history.lastConversation')}</Text>
            </Pressable>
          )}
          {group.last_conversation_id && renderOpen(group.last_conversation_id, 'last')}

          {video && (
            video.url ? (
              <Pressable style={styles.round} onPress={() => setPlaying(true)} accessibilityRole="button">
                <Text style={styles.openNote}>{t('history.viewVideo')}</Text>
                <Feather name="play" size={18} color={palette.checkOff} />
              </Pressable>
            ) : video.purged ? (
              <Text style={styles.roundMeta}>{t('history.videoPurged')}</Text>
            ) : null
          )}

          <Text style={styles.sectionTitle}>{t('history.roundsTitle')}</Text>
          {group.practices.map((round) => (
            <View
              key={round.id}
              style={styles.card}>
              <View style={styles.roundBody}>
                <Text style={styles.roundTitle}>{roundSummary(round)}</Text>
                <Text style={styles.roundMeta}>
                  {formatKoreanDate(round.created_at, { month: 'long', day: 'numeric' })}
                </Text>
              </View>
              {round.note && (
                <Pressable style={styles.round} onPress={() => openNote(round.id)} accessibilityRole="button">
                  <Text style={styles.openNote}>{t('history.openNote')}</Text>
                  <Feather name="chevron-right" size={18} color={palette.checkOff} />
                </Pressable>
              )}
              {round.conversation_id && (
                <Pressable style={styles.round} onPress={() => void openConversation(round.conversation_id!)} accessibilityRole="button">
                  <Text style={styles.openNote}>{t('history.conversation')}</Text>
                </Pressable>
              )}
              {round.conversation_id && renderOpen(round.conversation_id)}
              {round.previous_conversations.map(previous => (
                <Pressable key={previous.id} style={styles.round} onPress={() => void openConversation(previous.id)} accessibilityRole="button">
                  <Text style={styles.openNote}>{t('history.previousConversation')} · {formatKoreanDate(previous.created_at, { month: 'long', day: 'numeric' })}</Text>
                </Pressable>
              ))}
              {round.previous_conversations.map(previous => renderOpen(previous.id))}
            </View>
          ))}

          {action.kind === 'nextTake' && (
            <View ref={continueTarget.ref} onLayout={continueTarget.onLayout} collapsable={false} style={styles.primaryWrap}>
              <PrimaryButton label={t(continueActionLabel(action))} onPress={startNextTake} />
            </View>
          )}
          <Pressable onPress={() => void toggleHidden()} accessibilityRole="button">
            <Text style={styles.hideLink}>{group.hidden_at ? t('history.unhide') : t('history.hideConfirm')}</Text>
          </Pressable>
          <Text style={styles.hideNotice}>{t('history.hideNotice')}</Text>
        </ScrollView>
      )}
      <PracticeMenu visible={menuOpen} title={t('history.menuTitle')} items={menuItems} onClose={() => setMenuOpen(false)} />
      <RenameDialog
        visible={renameOpen}
        title={t('history.menuRename')}
        initial={group?.title?.trim() ?? ''}
        placeholder={group ? groupTitle(group) : ''}
        hint={t('history.renameHint')}
        failText={t('history.renameFail')}
        cancelLabel={t('common.cancel')}
        saveLabel={t('common.save')}
        maxLength={PRACTICE_TITLE_MAX}
        onSave={rename}
        onClose={() => setRenameOpen(false)}
      />
      <PracticeVideoModal uri={playing ? video?.url ?? null : null} onClose={() => setPlaying(false)} />
      {dialog}
      <SpotlightGuide
        visible={guideOpen}
        topic="group"
        steps={CONTINUE_STEPS}
        onDone={() => {
          setGuideOpen(false);
          void markSpotlightSeen('group');
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  center: { paddingVertical: 48, alignItems: 'center' },
  error: { color: palette.danger, textAlign: 'center', paddingVertical: 16 },
  body: { padding: 20, paddingBottom: 48, gap: 14 },
  headRow: { gap: 4 },
  title: { fontSize: 22, fontWeight: '900', color: palette.text, lineHeight: 32 },
  meta: { fontSize: 12.5, fontWeight: '700', color: palette.textFaint },
  card: { backgroundColor: palette.bgSubtle, borderRadius: 14, padding: 16, gap: 6 },
  chat: { gap: 12, paddingVertical: 8 },
  coachRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingRight: 36 },
  coachBubble: { flexShrink: 1, backgroundColor: palette.bgSoft, borderRadius: 16, paddingVertical: 10, paddingHorizontal: 14 },
  meBubble: { alignSelf: 'flex-end', maxWidth: '78%', backgroundColor: palette.blue, borderRadius: 16, paddingVertical: 10, paddingHorizontal: 14 },
  meText: { fontSize: 14.5, lineHeight: 22, color: palette.onAccent },
  cardLabel: { fontSize: 12, fontWeight: '800', color: palette.textDim },
  cardText: { fontSize: 14.5, lineHeight: 23, color: palette.text },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: palette.textFaint, marginTop: 8 },
  round: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: palette.borderSoft,
  },
  roundBody: { flex: 1, gap: 3 },
  roundTitle: { fontSize: 15, fontWeight: '700', color: palette.text },
  roundMeta: { fontSize: 12.5, color: palette.textFaint },
  openNote: { fontSize: 12.5, fontWeight: '800', color: palette.blueDeep },
  primaryWrap: { marginTop: 16 },
  hideLink: { fontSize: 13, fontWeight: '800', color: palette.textFaint, textAlign: 'center', paddingVertical: 10 },
  hideNotice: { fontSize: 12, color: palette.textFaint, textAlign: 'center', lineHeight: 19 },
});
