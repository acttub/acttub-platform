import Feather from '@expo/vector-icons/Feather';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
import { palette } from '@/constants/palette';
import { api } from '@/lib/api';
import { formatKoreanDate } from '@/lib/format';
import { translate as t } from '@/lib/i18n';
import { groupTitle, hideNotice, roundSummary } from '@/lib/practice/groups';
import { orderedMessages } from '@/lib/practice/coach';
import { setContinueOrigin } from '@/lib/practice/session-state';
import { SpotlightGuide, type SpotlightStep } from '@/components/spotlight-guide';
import { useSpotlightTarget } from '@/hooks/use-spotlight-target';
import { hasSeenSpotlight, markSpotlightSeen } from '@/lib/guide-state';
import { TARGET } from '@/lib/spotlight-targets';
import type { CoachConversation, PracticeGroupDetail } from '@/lib/practice/types';

/** 처음 한 번 비추는 자리 — "이어서 연습하기" 버튼. */
const CONTINUE_STEPS: SpotlightStep[] = [{ target: TARGET.groupContinue, text: 'guide.spotContinue' }];

/**
 * A1.2 연습 기록 상세 — 묶음 하나.
 *
 * 묶음의 영상, 회차 흐름(n차 · 시각 · 대화 수 · 노트 제목 · 노트 보기), 마지막 대화,
 * "이어서 연습하기"를 보여 준다(practice.library). 이어서 연습하기는 그 회차의 영상을 그대로
 * 쓰고 장면은 비운 채 시작한다(practice.resume). 숨김은 묶음 전체이고 영상은 보관함에 남는다.
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
  const [conversationLoading, setConversationLoading] = useState(false);
  const conversationRequest = useRef(0);
  // 처음 한 번만 "이어서 연습할 수 있어요!"를 비춘다. 버튼이 목록 맨 아래라 먼저 내려 준다.
  const scrollRef = useRef<ScrollView>(null);
  const continueTarget = useSpotlightTarget(TARGET.groupContinue);
  const [guideOpen, setGuideOpen] = useState(false);

  useEffect(() => {
    if (!group) return;
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

  const openConversation = async (id: string) => {
    const request = ++conversationRequest.current;
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

  /** 같은 영상으로 같은 묶음의 다음 회차를 만든다. 장면은 비운 채 시작한다. */
  const continuePractice = () => {
    if (!group) return;
    if (group.in_progress_practice_id) {
      router.push({ pathname: '/analyzing', params: { practiceId: group.in_progress_practice_id } });
      return;
    }
    const last = group.practices[group.practices.length - 1];
    setContinueOrigin(
      group.video_id
        ? { kind: 'history', rootId: group.root_id, practiceId: last?.id ?? group.root_id, videoId: group.video_id }
        : { kind: 'group', rootId: group.root_id, practiceId: last?.id ?? group.root_id },
    );
    router.push('/upload');
  };

  const toggleHidden = async () => {
    if (!group) return;
    const hiding = !group.hidden_at;
    if (hiding) {
      const ok = await confirm({
        title: t('history.hideTitle'),
        message: hideNotice(),
        confirmLabel: t('history.hideConfirm'),
        destructive: true,
      });
      if (!ok) return;
    }
    try {
      setGroup(await api.patchPracticeGroup(group.root_id, { hidden: hiding }));
    } catch (e) {
      await alert({
        title: t('history.deleteFailTitle'),
        message: e instanceof Error ? e.message : t('history.deleteFail'),
      });
    }
  };

  const openNote = (practiceId: string, hasNote: boolean) => {
    if (!hasNote) {
      void alert({ title: t('note.title'), message: t('history.noteMissing') });
      return;
    }
    router.push({ pathname: '/report-detail', params: { practiceId } });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: group ? groupTitle(group) : t('history.title'), headerShadowVisible: false }} />
      {loading && (
        <View style={styles.center}>
          <ActivityIndicator color={palette.blue} />
        </View>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
      {group && (
        <ScrollView ref={scrollRef} contentContainerStyle={styles.body}>
          <View style={styles.headRow}>
            <Text style={styles.title}>{groupTitle(group)}</Text>
            <Text style={styles.meta}>{t('history.countTimes', { count: group.ordinal_count })}</Text>
          </View>

          {group.video_id && (
            <Pressable style={styles.round} onPress={() => router.push({ pathname: '/archive-detail', params: { id: group.video_id! } })} accessibilityRole="button">
              <Text style={styles.openNote}>{t('history.openVideo')}</Text>
            </Pressable>
          )}
          {group.last_conversation_id && (
            <Pressable style={styles.round} onPress={() => void openConversation(group.last_conversation_id!)} accessibilityRole="button">
              <Text style={styles.openNote}>{t('history.lastConversation')}</Text>
            </Pressable>
          )}
          {conversationLoading && <ActivityIndicator color={palette.blue} />}
          {conversationError && <Text style={styles.error}>{conversationError}</Text>}
          {conversation && (
            <View style={styles.card}>
              <Text style={styles.cardLabel}>{t('history.conversation')}</Text>
              {orderedMessages(conversation).map(message => (
                <View key={message.turn_index}>
                  <Text style={styles.cardLabel}>{t(message.role === 'coach' ? 'coach.roleCoach' : 'coach.roleMe')}</Text>
                  <Text style={styles.cardText}>{message.text}</Text>
                </View>
              ))}
            </View>
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
                <Pressable style={styles.round} onPress={() => openNote(round.id, true)} accessibilityRole="button">
                  <Text style={styles.openNote}>{t('history.openNote')}</Text>
                  <Feather name="chevron-right" size={18} color={palette.checkOff} />
                </Pressable>
              )}
              {round.conversation_id && (
                <Pressable style={styles.round} onPress={() => void openConversation(round.conversation_id!)} accessibilityRole="button">
                  <Text style={styles.openNote}>{t('history.conversation')}</Text>
                </Pressable>
              )}
              {round.previous_conversations.map(previous => (
                <Pressable key={previous.id} style={styles.round} onPress={() => void openConversation(previous.id)} accessibilityRole="button">
                  <Text style={styles.openNote}>{t('history.previousConversation')} · {formatKoreanDate(previous.created_at, { month: 'long', day: 'numeric' })}</Text>
                </Pressable>
              ))}
            </View>
          ))}

          <Pressable
            ref={continueTarget.ref}
            onLayout={continueTarget.onLayout}
            style={styles.primary}
            onPress={continuePractice}
            accessibilityRole="button">
            <Text style={styles.primaryText}>{t('history.continueCta')}</Text>
          </Pressable>
          <Pressable onPress={() => void toggleHidden()} accessibilityRole="button">
            <Text style={styles.hideLink}>{group.hidden_at ? t('history.unhide') : t('history.hideConfirm')}</Text>
          </Pressable>
          <Text style={styles.hideNotice}>{hideNotice()}</Text>
        </ScrollView>
      )}
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
  center: { paddingVertical: 48, alignItems: 'center' },
  error: { color: palette.danger, textAlign: 'center', paddingVertical: 16 },
  body: { padding: 20, paddingBottom: 48, gap: 14 },
  headRow: { gap: 4 },
  title: { fontSize: 22, fontWeight: '900', color: palette.text, lineHeight: 32 },
  meta: { fontSize: 12.5, fontWeight: '700', color: palette.textFaint },
  card: { backgroundColor: palette.bgSubtle, borderRadius: 14, padding: 16, gap: 6 },
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
  primary: {
    height: 52,
    borderRadius: 14,
    backgroundColor: palette.blue,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  primaryText: { fontSize: 15, fontWeight: '900', color: palette.bg },
  hideLink: { fontSize: 13, fontWeight: '800', color: palette.textFaint, textAlign: 'center', paddingVertical: 10 },
  hideNotice: { fontSize: 12, color: palette.textFaint, textAlign: 'center', lineHeight: 19 },
});
