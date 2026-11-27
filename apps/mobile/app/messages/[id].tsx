import Feather from '@expo/vector-icons/Feather';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
import { CommunityReportPage } from '@/components/community/community-report-page';
import { KeyboardLift } from '@/components/keyboard-lift';
import { PartnerAvatar } from '@/components/messages/partner-avatar';
import { pt } from '@/components/ui/anchored-menu';
import { TextButton } from '@/components/ui/buttons';
import { ChatComposer } from '@/components/ui/chat-composer';
import { InlineErrorLine } from '@/components/ui/inline-error';
import { NavBackButton, NavHeader, NavIconButton } from '@/components/ui/nav-header';
import { SkeletonDetail } from '@/components/ui/skeleton';
import { StatusScreen } from '@/components/ui/status-screen';
import { easing, motion } from '@/constants/motion';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { useReadableInput } from '@/hooks/use-readable-input';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import type { CommunityReportReason } from '@/lib/community';
import { translate as t } from '@/lib/i18n';
import {
  MESSAGE_MAX,
  POLL_MS,
  bubbles,
  canSendBody,
  mergeMessages,
  sendFailure,
  startFailure,
  unavailableKey,
  type Bubble,
  type DirectConversation,
  type DirectMessage,
  type PendingMessage,
} from '@/lib/messages';
import { newRequestId } from '@/lib/request-id';

type Failure = 'gone' | 'error' | 'blocked' | 'limit' | 'member_only';

/**
 * 1:1 메시지 대화방(SOMA-1039). 머리 NavHeader(상대 이름 + 오른쪽 ⋯: 신고하기·이 사람 차단하기), 그 아래 대화를 연 글 한 줄
 * (누르면 그 글로), 말풍선(내 것 오른쪽 파랑, 상대 왼쪽 회색), 아래 입력칸 + 「보내기」. 키보드 처리는 게시판 글 화면과 같다.
 *
 * 게시판 글·댓글의 작성자 이름에서 오면 `id=new`·`userId`·`postId`·`from` 을 받아 여기서 대화를 연다(이미 있으면 그 대화).
 * 화면이 보이는 동안 5초마다 새 메시지를 묻고, 상대 메시지가 오면 읽음을 남긴다. 푸시를 눌러 오면 대화 id 로 바로 연다.
 * 보내는 말풍선은 흐리게 먼저 그리고 서버 답으로 진하게 바꾼다. 실패하면 「다시 보내기」 — 처음 요청 id 를 그대로 쓴다.
 */
export default function ConversationScreen() {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const { confirm, alert, sheet, dialog } = useAppDialog();
  const params = useLocalSearchParams<{ id: string; userId?: string; postId?: string; from?: string }>();
  const [conversationId, setConversationId] = useState<string | null>(params.id && params.id !== 'new' ? params.id : null);
  const [conversation, setConversation] = useState<DirectConversation | null>(null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [failed, setFailed] = useState<Failure | null>(null);
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  /** 처음 받은 말풍선은 떠오르지 않는다 — 들어온 뒤에 생긴 것만 아래에서 살짝 떠오른다. */
  const seen = useRef<Set<string> | null>(null);
  const changeDraft = useCallback((v: string) => {
    setDraft(v);
    setNotice(null);
  }, []);
  const readable = useReadableInput(changeDraft);

  // 글·댓글에서 왔으면 대화를 연다(SOMA-1039). 이미 있으면 서버가 그 대화를 준다.
  const starting = useRef(false);
  const [startAttempt, setStartAttempt] = useState(0);
  useEffect(() => {
    if (conversationId || starting.current || !params.userId) {
      if (!conversationId && !params.userId) setFailed('gone');
      return;
    }
    starting.current = true;
    void api
      .startDirectConversation({ user_id: params.userId, ...(params.postId ? { post_id: params.postId } : {}) })
      .then((started) => {
        logEvent('dm_start', { from: params.from === 'comment' ? 'comment' : 'post' });
        setConversation(started);
        setConversationId(started.id);
      })
      .catch((e: unknown) => {
        const reason = startFailure(e);
        starting.current = false;
        setFailed(reason === 'blocked' ? 'blocked' : reason === 'gone' ? 'gone' : reason === 'daily_limit' ? 'limit' : reason === 'member_only' ? 'member_only' : 'error');
      });
  }, [conversationId, params.userId, params.postId, params.from, startAttempt]);

  const markRead = useCallback((id: string) => {
    void api.markConversationRead(id).catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    if (!conversationId) return;
    setFailed(null);
    try {
      const [detail, page] = await Promise.all([api.conversation(conversationId), api.listMessages(conversationId)]);
      setConversation(detail);
      setMessages((prev) => {
        const merged = mergeMessages(prev, page.messages);
        if (!seen.current) seen.current = new Set(merged.map((m) => m.id));
        return merged;
      });
      setOlderCursor((prev) => prev ?? page.next_cursor ?? null);
      markRead(conversationId);
    } catch (e) {
      setFailed(startFailure(e) === 'gone' ? 'gone' : 'error');
    }
  }, [conversationId, markRead]);

  // 보이는 동안만 새 메시지를 묻는다. 상대 메시지가 새로 오면 읽음을 남긴다.
  useFocusEffect(
    useCallback(() => {
      void load();
      if (!conversationId) return undefined;
      const timer = setInterval(() => {
        void api
          .listMessages(conversationId)
          .then((page) => {
            setMessages((prev) => {
              const have = new Set(prev.map((m) => m.id));
              if (page.messages.some((m) => !m.mine && !have.has(m.id))) markRead(conversationId);
              return mergeMessages(prev, page.messages);
            });
          })
          .catch(() => undefined);
      }, POLL_MS);
      return () => clearInterval(timer);
    }, [load, conversationId, markRead]),
  );

  const loadOlder = async () => {
    if (!conversationId || !olderCursor) return;
    const page = await api.listMessages(conversationId, olderCursor).catch(() => null);
    if (!page) return;
    // 옛 메시지는 떠오르지 않는다.
    page.messages.forEach((m) => seen.current?.add(m.id));
    setMessages((prev) => mergeMessages(prev, page.messages));
    setOlderCursor(page.next_cursor ?? null);
  };

  const deliver = async (item: PendingMessage) => {
    if (!conversationId) return;
    setPending((prev) => prev.map((p) => (p.key === item.key ? { ...p, status: 'sending' } : p)));
    try {
      const sent = await api.sendMessage(conversationId, { request_id: item.requestId, body: item.body });
      setPending((prev) => prev.filter((p) => p.key !== item.key));
      // 방금 보낸 것은 흐린 말풍선이 이미 떠올랐으니 다시 떠오르지 않는다.
      seen.current?.add(sent.id);
      setMessages((prev) => mergeMessages(prev, [sent]));
      logEvent('dm_send');
    } catch (e) {
      const reason = sendFailure(e);
      setPending((prev) => prev.map((p) => (p.key === item.key ? { ...p, status: 'failed' } : p)));
      if (reason === 'daily_limit') setNotice(t('messages.dailyLimit'));
      // 차단·상대 탈퇴는 다시 보내도 같다 — 머리를 다시 받아 입력칸 대신 안내를 둔다.
      if (reason === 'blocked' || reason === 'partner_left') void load();
    }
  };

  const send = () => {
    const body = draft.trim();
    if (!canSendBody(body)) return;
    const item: PendingMessage = { key: `pending-${newRequestId()}`, requestId: newRequestId(), body, status: 'sending' };
    setPending((prev) => [...prev, item]);
    setDraft('');
    void deliver(item);
  };

  const block = async () => {
    if (!conversation) return;
    const ok = await confirm({
      title: t('communityPost.blockTitle'),
      message: t('messages.blockMsg'),
      confirmLabel: t('communityPost.blockConfirm'),
      destructive: true,
    });
    if (!ok) return;
    try {
      // 게시판의 차단 걸기를 그대로 쓴다(user_blocks) — 풀기는 설정의 차단 목록에서 한다.
      await api.blockCommunityUser(conversation.partner.id);
      logEvent('dm_block');
      await load();
    } catch {
      await alert({ title: t('communityPost.blockFail'), message: t('common.tryLater') });
    }
  };

  const submitReport = async (reason: CommunityReportReason, detail: string) => {
    if (!conversationId || reporting) return;
    setReporting(true);
    try {
      await api.reportConversation(conversationId, { reason, ...(detail ? { detail } : {}) });
      logEvent('dm_report', { reason });
      setReportOpen(false);
      await alert({ title: t('communityPost.reportedTitle'), message: t('communityPost.reportedBody') });
    } catch (e) {
      setReportOpen(false);
      const duplicate = (e as { status?: number } | null)?.status === 409;
      await alert({ title: t('communityPost.reportFailTitle'), message: duplicate ? t('communityPost.reportDuplicate') : t('common.tryLater') });
    } finally {
      setReporting(false);
    }
  };

  const openMenu = (e?: GestureResponderEvent) => {
    void sheet({
      anchor: pt(e),
      actions: [
        { label: t('messages.report'), onPress: () => setReportOpen(true) },
        ...(conversation && !conversation.partner.withdrawn ? [{ label: t('messages.block'), onPress: () => void block() }] : []),
      ],
    });
  };

  const back = () => router.back();
  const title = conversation?.partner.name ?? t('messages.title');

  if (failed) {
    const copy: Record<Failure, string> = {
      gone: t('messages.goneTitle'),
      error: conversationId ? t('messages.loadFail') : t('messages.startFail'),
      blocked: t('messages.blocked'),
      limit: t('messages.startLimit'),
      member_only: t('community.memberOnly'),
    };
    const retryable = failed === 'error';
    return (
      <StatusScreen
        safeArea
        kind={retryable ? undefined : 'empty'}
        header={title}
        onBack={back}
        title={copy[failed]}
        primary={
          retryable
            ? {
                label: t('common.retry'),
                onPress: () => {
                  setFailed(null);
                  if (conversationId) void load();
                  else setStartAttempt((n) => n + 1);
                },
              }
            : { label: t('messages.backToList'), onPress: back }
        }
      />
    );
  }

  if (!conversation) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <NavHeader title={title} left={<NavBackButton onPress={back} />} />
        <SkeletonDetail lines={4} />
      </SafeAreaView>
    );
  }

  const closed = unavailableKey(conversation);
  const list = bubbles(messages, pending);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <NavHeader
        title={title}
        left={<NavBackButton onPress={back} phLabel="dm_back" />}
        right={<NavIconButton icon="more-horizontal" label={t('messages.menuA11y')} phLabel="dm_menu" onPress={(e) => openMenu(e)} />}
      />
      {conversation.origin_post ? (
        <Pressable
          style={({ pressed }) => [styles.origin, pressed && styles.pressed]}
          onPress={() => router.push({ pathname: '/community-post', params: { id: conversation.origin_post!.id } })}
          accessibilityRole="link"
          accessibilityLabel={t('messages.originA11y', { title: conversation.origin_post.title })}
          ph-label="dm_origin_post">
          <Feather name="file-text" size={14} color={palette.textSub} />
          <Text style={styles.originText} numberOfLines={1}>
            {t('messages.origin', { title: conversation.origin_post.title })}
          </Text>
          <Feather name="chevron-right" size={14} color={palette.iconFaint} />
        </Pressable>
      ) : null}
      <KeyboardLift aboveSafeBottom>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}>
          {olderCursor ? (
            <View style={styles.older}>
              <TextButton tone="accent" label={t('messages.older')} phLabel="dm_older" onPress={() => void loadOlder()} />
            </View>
          ) : null}
          {list.map((item) => (
            <BubbleRow
              key={item.key}
              item={item}
              partnerPhoto={conversation.partner.photo_url}
              partnerId={conversation.partner.id}
              animate={!reduceMotion && !(item.kind === 'sent' && seen.current?.has(item.key))}
              onRetry={(p) => void deliver(p)}
            />
          ))}
        </ScrollView>

        <View style={styles.bar}>
          {closed ? (
            <Text style={styles.closed}>{t(closed)}</Text>
          ) : (
            <>
              {notice || readable.hint ? <InlineErrorLine message={notice ?? readable.hint ?? ''} /> : null}
              <ChatComposer
                value={draft}
                onChangeText={readable.onChangeText}
                placeholder={t('messages.inputPh')}
                label={t('messages.inputPh')}
                maxLength={MESSAGE_MAX}
                canSend={canSendBody(draft)}
                onSend={send}
                sendLabel={t('messages.send')}
                sendPhLabel="dm_send"
              />
            </>
          )}
        </View>
      </KeyboardLift>
      <CommunityReportPage
        visible={reportOpen}
        target="conversation"
        busy={reporting}
        onClose={() => setReportOpen(false)}
        onSubmit={(reason, detail) => void submitReport(reason, detail)}
      />
      {dialog}
    </SafeAreaView>
  );
}

/** 말풍선 한 줄. 내 것은 오른쪽 파랑, 상대 것은 왼쪽 회색(얼굴과 함께). 보내는 중은 흐리고, 실패하면 아래에 「다시 보내기」. */
function BubbleRow({
  item,
  partnerPhoto,
  partnerId,
  animate,
  onRetry,
}: {
  item: Bubble;
  partnerPhoto: string | null;
  partnerId: string;
  animate: boolean;
  onRetry: (pending: PendingMessage) => void;
}) {
  const mine = item.kind === 'pending' || item.message.mine;
  const body = item.kind === 'pending' ? item.pending.body : item.message.body;
  const sending = item.kind === 'pending' && item.pending.status === 'sending';
  const failedItem = item.kind === 'pending' && item.pending.status === 'failed' ? item.pending : null;
  return (
    <Animated.View
      entering={animate ? FadeInDown.duration(motion.standard).easing(easing.enter) : undefined}
      style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}
      testID={item.kind === 'pending' ? `dm-pending-${item.pending.status}` : `dm-message-${item.key}`}>
      {!mine ? <PartnerAvatar uri={partnerPhoto} seed={partnerId} size={28} /> : null}
      <View style={[styles.column, mine && styles.columnMine]}>
        <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs, sending && styles.sending]}>
          <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]} selectable>
            {body}
          </Text>
        </View>
        {failedItem ? (
          <Pressable
            onPress={() => onRetry(failedItem)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('messages.retry')}
            ph-label="dm_retry"
            style={styles.retry}>
            <Feather name="alert-circle" size={12} color={palette.danger} />
            <Text style={styles.retryText}>
              {t('messages.sendFail')} · {t('messages.retry')}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  pressed: { opacity: 0.6 },
  origin: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1.5],
    paddingHorizontal: space.gutter,
    paddingVertical: space[2],
    backgroundColor: palette.bgSoft,
  },
  originText: { ...type.caption, color: palette.textSub, flex: 1 },
  body: { paddingHorizontal: space.gutter, paddingTop: space[3], paddingBottom: space[3], gap: space[2] },
  older: { alignItems: 'center', paddingBottom: space[2] },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: space[2] },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  column: { maxWidth: '78%', gap: space[1] },
  columnMine: { alignItems: 'flex-end' },
  bubble: { paddingHorizontal: space[3], paddingVertical: space[2], borderRadius: radius.lg },
  bubbleMine: { backgroundColor: palette.blue },
  bubbleTheirs: { backgroundColor: palette.bgSoft },
  sending: { opacity: 0.5 },
  bubbleText: { ...type.body2, color: palette.text },
  bubbleTextMine: { color: palette.onAccent },
  retry: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  retryText: { ...type.caption, color: palette.danger },
  bar: {
    borderTopWidth: 1,
    borderTopColor: palette.border,
    backgroundColor: palette.bg,
    paddingTop: space[3],
    paddingBottom: space[3],
    paddingHorizontal: space.gutter,
    gap: space[2],
  },
  closed: { ...type.body2, color: palette.textSub, textAlign: 'center', paddingVertical: space[2] },
});
