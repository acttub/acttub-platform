import Feather from '@expo/vector-icons/Feather';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
import { palette } from '@/constants/palette';
import { api } from '@/lib/api';
import { formatKoreanDate } from '@/lib/format';
import { translate as t } from '@/lib/i18n';
import { groupTitle, hideNotice, roundSummary } from '@/lib/practice/groups';
import { setContinueOrigin } from '@/lib/practice/session-state';
import type { PracticeGroupDetail } from '@/lib/practice/types';

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
  }, [load]);

  /** 같은 영상으로 같은 묶음의 다음 회차를 만든다. 장면은 비운 채 시작한다. */
  const continuePractice = () => {
    if (!group) return;
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
      await api.patchPracticeGroup(group.root_id, { hidden: hiding });
      void load();
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
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.headRow}>
            <Text style={styles.title}>{groupTitle(group)}</Text>
            <Text style={styles.meta}>{t('history.countTimes', { count: group.ordinal_count })}</Text>
          </View>

          {group.last_conversation && (
            <View style={styles.card}>
              <Text style={styles.cardLabel}>{t('history.lastConversation')}</Text>
              <Text style={styles.cardText}>{group.last_conversation}</Text>
            </View>
          )}

          <Text style={styles.sectionTitle}>{t('history.roundsTitle')}</Text>
          {group.practices.map((round) => (
            <Pressable
              key={round.id}
              style={styles.round}
              onPress={() => openNote(round.id, Boolean(round.note))}
              accessibilityRole="button">
              <View style={styles.roundBody}>
                <Text style={styles.roundTitle}>{roundSummary(round)}</Text>
                <Text style={styles.roundMeta}>
                  {formatKoreanDate(round.created_at, { month: 'long', day: 'numeric' })}
                </Text>
              </View>
              {round.note ? <Text style={styles.openNote}>{t('history.openNote')}</Text> : null}
              <Feather name="chevron-right" size={18} color={palette.checkOff} />
            </Pressable>
          ))}

          <Pressable style={styles.primary} onPress={continuePractice} accessibilityRole="button">
            <Text style={styles.primaryText}>{t('history.continueCta')}</Text>
          </Pressable>
          <Pressable onPress={() => void toggleHidden()} accessibilityRole="button">
            <Text style={styles.hideLink}>{group.hidden_at ? t('history.unhide') : t('history.hideConfirm')}</Text>
          </Pressable>
          <Text style={styles.hideNotice}>{hideNotice()}</Text>
        </ScrollView>
      )}
      {dialog}
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
