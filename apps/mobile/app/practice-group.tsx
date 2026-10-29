import Feather from '@expo/vector-icons/Feather';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Image } from 'expo-image';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
import { pt } from '@/components/ui/anchored-menu';
import { Button, PrimaryButton, TextButton } from '@/components/ui/buttons';
import { CtaBar } from '@/components/ui/cta-bar';
import { InlineError } from '@/components/ui/inline-error';
import { StatusScreen } from '@/components/ui/status-screen';
import { MASCOT, MASCOT_SIZE } from '@/components/ui/mascot';
import { RenameDialog } from '@/components/ui/coach-rename-dialog';
import { NavIconButton } from '@/components/ui/nav-header';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
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
import { countedPractices } from '@/lib/practice/counted';
import { skipsGroupGuide } from '@/lib/returning-account';
import { TARGET } from '@/lib/spotlight-targets';
import type { CoachConversation, PracticeGroupDetail } from '@/lib/practice/types';
import { SkeletonRows } from '@/components/ui/skeleton';

/** 처음 한 번 비추는 자리 — 「다음 테이크 찍기」 버튼. */
const CONTINUE_STEPS: SpotlightStep[] = [{ target: TARGET.groupContinue, text: 'guide.spotContinue' }];

/**
 * A1.2 연습 기록 상세 — 묶음 하나.
 *
 * 묶음의 영상, 회차 흐름(n차 · 시각 · 대화 수 · 노트 제목 · 노트 보기), 마지막 대화와 이어 가는 버튼 하나를
 * 보여 준다(practice.library). 열린 테이크가 있으면 그 회차 카드 안에 「대화 이어 가기」(그 대화로 바로), 아래 고정 바에
 * 「다음 테이크 찍기」(새 영상을 골라 장면은 비운 채 시작)다(practice.resume, SOMA-672). 숨김은 묶음 전체이고
 * 영상은 보관함에 남는다.
 *
 * 머리 「⋯」 하나가 Menu 를 연다(pen practice-group.menu) — 제목 바꾸기(묶음 제목 PATCH), 기록에서 숨기기(되돌릴 수 있음),
 * 영상 지우기(파일만 파기, danger). 숨긴 묶음은 머리 버튼이 없고 아래 「다시 보이기」로 되돌린다.
 * 디자인의 「지난 테이크와 비교」·「이 테이크만 지우기」는 서버 기능(테이크 비교문·회차 삭제)이 없어 두지 않는다.
 */
export default function PracticeGroupScreen() {
  const router = useRouter();
  const { rootId } = useLocalSearchParams<{ rootId?: string }>();
  const { confirm, alert, sheet, dialog } = useAppDialog();
  const [group, setGroup] = useState<PracticeGroupDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [conversation, setConversation] = useState<CoachConversation | null>(null);
  const [conversationError, setConversationError] = useState<string | null>(null);
  const conversationRequest = useRef(0);
  // P10.2 「연습 영상 보기」 — 묶음 영상의 재생 주소. 파기됐으면 purged.
  const [video, setVideo] = useState<{ url: string | null; purged: boolean } | null>(null);
  const [playing, setPlaying] = useState(false);
  // 지금 펼쳐 둔 대화의 id. 같은 줄을 다시 누르면 접는다(카드를 누르면 아래로 펼친다).
  const [openId, setOpenId] = useState<string | null>(null);
  // 같은 대화가 「마지막 대화」와 회차 카드의 「대화」 두 줄에 걸려 있어 둘 다 펼쳐지던 것을 막는다 — 누른 줄 아래에만 붙인다.
  const [openSlot, setOpenSlot] = useState<'last' | 'round' | null>(null);
  // 처음 한 번만 "이어서 연습할 수 있어요!"를 비춘다(버튼은 아래 고정 바).
  // 대화 중인 묶음은 「다음 테이크 찍기」가 없으니 비추지 않는다(다음에 들어왔을 때 비춘다).
  const continueTarget = useSpotlightTarget(TARGET.groupContinue);
  const [guideOpen, setGuideOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);

  useEffect(() => {
    if (!group || group.in_progress_practice_id) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let alive = true;
    void hasSeenSpotlight('group').then(async (seen) => {
      if (seen || !alive) return;
      // 안내를 본 기록은 기기에만 남아, 다시 깐 기존 계정에도 떴다 — 서버 기록으로 이미 써 본 계정이면 본 것으로 남긴다.
      const groups = await Promise.resolve()
        .then(() => api.listPracticeGroups('all'))
        .then((r) => r.groups)
        .catch(() => null);
      if (!alive) return;
      if (groups && skipsGroupGuide({
        countedPracticeCount: countedPractices({ groups }).length,
        continuedBefore: groups.some((g) => g.practices.length > 1),
      })) {
        void markSpotlightSeen('group');
        return;
      }
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
      return;
    }
    setOpenId(id);
    setOpenSlot(slot);
    await fetchConversation(id, request);
  };

  const fetchConversation = async (id: string, request = ++conversationRequest.current) => {
    setConversation(null);
    setConversationError(null);
    try {
      const loaded = await api.getConversation(id);
      if (request === conversationRequest.current) setConversation(loaded);
    } catch {
      if (request === conversationRequest.current) setConversationError(t('history.conversationLoadFail'));
    }
  };

  const load = useCallback(async () => {
    if (!rootId) {
      setError(t('history.groupLoadFail'));
      setLoading(false);
      return;
    }
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

  /** 숨김은 묶음 전체이고 되돌릴 수 있다. 메뉴에서 숨기면 돌아갈 목록이 있을 때 그 목록으로 간다. */
  const toggleHidden = async () => {
    if (!group) return;
    const hiding = !group.hidden_at;
    if (hiding) {
      const ok = await confirm({
        title: t('history.hideTitle'),
        message: t('history.hideNotice'),
        confirmLabel: t('history.hideConfirm'),
      });
      if (!ok) return;
    }
    try {
      const next = await api.patchPracticeGroup(group.root_id, { hidden: hiding });
      if (hiding && router.canGoBack()) {
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

  const rename = async (title: string) => {
    if (!group) return;
    setGroup(await api.patchPracticeGroup(group.root_id, { title }));
  };

  /** 영상 지우기 — 회차·노트·대화는 남기고 영상 파일만 파기한다(practice.library 「파일만 파기」). */
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
      void alert({ title: t('history.purgeDone') });
      void load();
    } catch (e) {
      void alert({ title: t('history.purgeFail'), message: videoErrorMessage(e) });
    }
  };

  const openMenu = (e?: GestureResponderEvent) =>
    void sheet({
      anchor: pt(e),
      title: t('history.menuTitle'),
      actions: [
        // 이름 바꾸기 창은 따로 뜨는 모달이라 메뉴가 닫힌 뒤에 연다 — iOS 는 닫히는 모달 위에 새 창을 띄우지 못한다.
        { label: t('history.menuRename'), icon: 'edit-2', onPress: () => setTimeout(() => setRenameOpen(true), Platform.OS === 'ios' ? 450 : 0) },
        { label: t('history.menuHide'), icon: 'eye-off', onPress: () => void toggleHidden() },
        ...(group?.video_id && !video?.purged
          ? [{ label: t('history.menuPurge'), icon: 'video-off' as const, destructive: true, onPress: () => void purgeVideo() }]
          : []),
      ],
    });

  const openNote = (practiceId: string) => {
    router.push({ pathname: '/report-detail', params: { practiceId } });
  };

  /** 펼친 대화 — 코치는 왼쪽 bg-soft 말풍선(마스코트 머리), 나는 오른쪽 blue-deep 말풍선. 대화 줄 바로 아래에 붙는다. */
  const renderOpen = (id: string, slot: 'last' | 'round' = 'round') => {
    if (openId !== id || openSlot !== slot) return null;
    return (
      <View key={`open-${id}`} style={styles.chat}>
        {conversationError && <InlineError message={conversationError} onRetry={() => void fetchConversation(id)} />}
        {conversation &&
          orderedMessages(conversation).map((message) =>
            message.role === 'coach' ? (
              <View key={message.turn_index} style={styles.coachRow}>
                <Image source={MASCOT.coach} style={MASCOT_SIZE.chat} contentFit="contain" cachePolicy="memory-disk" accessibilityLabel={t('coach.roleCoach')} />
                <View style={styles.coachBubble}>
                  <Text style={styles.bubbleText}>{message.text}</Text>
                </View>
              </View>
            ) : (
              <View key={message.turn_index} style={styles.meBubble} accessibilityLabel={t('coach.roleMe')}>
                <Text style={[styles.bubbleText, styles.meText]}>{message.text}</Text>
              </View>
            ),
          )}
      </View>
    );
  };

  const dayLabel = (iso: string) => formatKoreanDate(iso, { month: 'long', day: 'numeric' });
  const resumeInRound = action.kind === 'resume' && !!group?.practices.some((round) => round.id === action.practiceId);
  const resumeButton =
    action.kind === 'resume' ? (
      <Button
        size="md"
        label={t(continueActionLabel(action))}
        icon={<Feather name="message-circle" size={16} color={palette.onAccent} />}
        onPress={() => resumeConversation(action.practiceId)}
      />
    ) : null;

  if (error) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <Stack.Screen options={{ title: t('history.title'), headerShadowVisible: false, headerRight: () => null }} />
        <StatusScreen title={error} body={t('settings.retryLater')} primary={rootId ? { label: t('common.retry'), onPress: () => void load() } : undefined} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen
        options={{
          title: group ? '' : t('history.title'),
          headerShadowVisible: false,
          headerRight: () =>
            group && !group.hidden_at ? (
              <NavIconButton icon="more-horizontal" label={t('history.menuOpen')} phLabel="practice_group_menu" onPress={openMenu} />
            ) : null,
        }}
      />
      {loading && <SkeletonRows count={4} avatar={false} />}
      {group && (
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.headRow}>
            <Text style={styles.title}>{groupTitle(group)}</Text>
            <Text style={styles.meta}>{t('history.countTimes', { count: group.ordinal_count })}</Text>
          </View>

          {/* 열린 테이크가 회차 목록에 없으면(서버가 아직 회차를 안 줌) 맨 위에 둔다. */}
          {action.kind === 'resume' && !resumeInRound && resumeButton}

          {group.last_conversation_id && (
            <Pressable style={styles.linkRow} onPress={() => void openConversation(group.last_conversation_id!, 'last')} accessibilityRole="button" accessibilityLabel={t('history.lastConversation')}>
              <Text style={styles.linkLabel}>{t('history.lastConversation')}</Text>
              <Feather name={openId === group.last_conversation_id && openSlot === 'last' ? 'chevron-up' : 'chevron-down'} size={18} color={palette.iconFaint} />
            </Pressable>
          )}
          {group.last_conversation_id && renderOpen(group.last_conversation_id, 'last')}

          {video && (
            video.url ? (
              <Pressable style={styles.linkRow} onPress={() => setPlaying(true)} accessibilityRole="button" accessibilityLabel={t('history.viewVideo')}>
                <Text style={styles.linkLabel}>{t('history.viewVideo')}</Text>
                <Feather name="play" size={18} color={palette.iconFaint} />
              </Pressable>
            ) : video.purged ? (
              <Text style={styles.roundMeta}>{t('history.videoPurged')}</Text>
            ) : null
          )}

          <Text style={styles.sectionTitle}>{t('history.roundsTitle')}</Text>
          {group.practices.map((round) => (
            <View key={round.id} style={styles.card}>
              <View style={styles.roundHead}>
                <Text style={styles.roundTitle}>{roundSummary(round)}</Text>
                <Text style={styles.roundMeta}>{dayLabel(round.created_at)}</Text>
              </View>
              {round.note && (
                <Pressable style={styles.roundLine} onPress={() => openNote(round.id)} accessibilityRole="button" accessibilityLabel={t('history.openNote')}>
                  <Text style={styles.roundLineLabel}>{t('history.openNote')}</Text>
                  <Feather name="chevron-right" size={18} color={palette.iconFaint} />
                </Pressable>
              )}
              {round.conversation_id && (
                <Pressable style={styles.roundLine} onPress={() => void openConversation(round.conversation_id!)} accessibilityRole="button" accessibilityLabel={t('history.conversation')}>
                  <Text style={styles.roundLineLabel}>{t('history.conversation')}</Text>
                  {/* 같은 줄끼리 모양을 맞춘다 — 「노트 보기」는 다른 화면으로 가는 꺾쇠, 대화는 이 자리에 펼치는 꺾쇠(10/28 폰 확인). */}
                  <Feather name={openId === round.conversation_id ? 'chevron-up' : 'chevron-down'} size={18} color={palette.iconFaint} />
                </Pressable>
              )}
              {round.conversation_id && renderOpen(round.conversation_id)}
              {round.previous_conversations.map((previous) => (
                <Pressable key={previous.id} style={styles.roundLine} onPress={() => void openConversation(previous.id)} accessibilityRole="button" accessibilityLabel={`${t('history.previousConversation')} · ${dayLabel(previous.created_at)}`}>
                  <Text style={styles.roundLineLabel}>{t('history.previousConversation')} · {dayLabel(previous.created_at)}</Text>
                  <Feather name={openId === previous.id ? 'chevron-up' : 'chevron-down'} size={18} color={palette.iconFaint} />
                </Pressable>
              ))}
              {round.previous_conversations.map((previous) => renderOpen(previous.id))}
              {resumeInRound && action.kind === 'resume' && action.practiceId === round.id && resumeButton}
            </View>
          ))}
        </ScrollView>
      )}
      {group && (action.kind === 'nextTake' || group.hidden_at) ? (
        <CtaBar safeBottom={false}>
          {group.hidden_at ? <TextButton label={t('history.unhide')} onPress={() => void toggleHidden()} /> : null}
          {action.kind === 'nextTake' && (
            <View ref={continueTarget.ref} onLayout={continueTarget.onLayout} collapsable={false}>
              <PrimaryButton label={t(continueActionLabel(action))} onPress={startNextTake} />
            </View>
          )}
        </CtaBar>
      ) : null}
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
  body: { paddingHorizontal: space.gutter, paddingTop: space[2], paddingBottom: space[10], gap: space[3] },
  headRow: { gap: space[1], paddingBottom: space[2] },
  title: { ...type.title2, color: palette.text },
  meta: { ...type.caption, color: palette.textMeta },
  linkRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  linkLabel: { ...type.body1Bold, color: palette.text },
  sectionTitle: { ...type.body2Bold, color: palette.textSub, marginTop: space[2] },
  card: { borderWidth: 1, borderColor: palette.border, borderRadius: radius.lg, padding: space[4], gap: space[1] },
  roundHead: { gap: space[1], paddingBottom: space[2] },
  roundTitle: { ...type.body1Bold, color: palette.text },
  roundMeta: { ...type.caption, color: palette.textMeta },
  roundLine: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: palette.border,
  },
  roundLineLabel: { ...type.body2Bold, color: palette.textSub },
  chat: { gap: space[3], paddingVertical: space[2] },
  coachRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space[2], paddingRight: space[8] },
  coachBubble: {
    flexShrink: 1,
    backgroundColor: palette.bgSoft,
    borderRadius: radius.lg,
    borderTopLeftRadius: radius.xs,
    paddingVertical: space[3],
    paddingHorizontal: space[4],
  },
  meBubble: {
    alignSelf: 'flex-end',
    maxWidth: '78%',
    backgroundColor: palette.blueDeep,
    borderRadius: radius.lg,
    borderTopRightRadius: radius.xs,
    paddingVertical: space[3],
    paddingHorizontal: space[4],
  },
  bubbleText: { ...type.body1, color: palette.text },
  meText: { color: palette.onAccent },
});
