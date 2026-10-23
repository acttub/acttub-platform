import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
import { purgeVideoFileIfDue } from '@/lib/practice/upload-options';
import { NoteSections } from '@/components/note-sections';
import { ReportRating } from '@/components/report-rating';
import { palette } from '@/constants/palette';
import { api } from '@/lib/api';
import { formatKoreanDate } from '@/lib/format';
import { translate as t } from '@/lib/i18n';
import { readOptionalJournal } from '@/lib/practice/journal';
import { noteFallbackNotice, noteKindLabel, noteTitle, readOptionalPracticeNote } from '@/lib/practice/note';
import { continueActionFor, continueActionLabel } from '@/lib/practice/resume';
import { setContinueOrigin } from '@/lib/practice/session-state';
import type { PracticeDetail, PracticeGroupDetail, PracticeNote } from '@/lib/practice/types';

/**
 * A12 지난 연습 노트 — 기록에서 회차를 누르면 열린다. 배우 일지가 있는 회차는 일지 화면(app/journal)으로 넘긴다(SOMA-720).
 *
 * 회차 id 로 노트를 읽는다(practice.note). 영상이 파기된 뒤에도 노트는 열린다. 묶음에 열린 테이크가 있으면
 * 「대화 이어 가기」로 그 대화에 돌아가고, 없으면 「다음 테이크 찍기」로 같은 묶음의 다음 회차를 만든다 —
 * 영상은 새로 고르고 장면은 비운 채 시작한다(practice.resume, SOMA-672).
 */
export default function ReportDetailScreen() {
  const router = useRouter();
  const { practiceId } = useLocalSearchParams<{ practiceId?: string }>();
  const [note, setNote] = useState<PracticeNote | null>(null);
  const [practice, setPractice] = useState<PracticeDetail | null>(null);
  // 열린 테이크가 있는지 보려고 묶음을 읽는다. 못 읽으면 「다음 테이크 찍기」이고, 그때 열린 테이크가 있으면
  // 준비 화면이 409 로 그 대화에 돌려보낸다.
  const [group, setGroup] = useState<Pick<PracticeGroupDetail, 'in_progress_practice_id'> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { alert, dialog } = useAppDialog();
  const loadRevision = useRef(0);

  const load = useCallback(async () => {
    const revision = ++loadRevision.current;
    if (!practiceId) {
      setError(t('note.loadFail'));
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setNote(null);
    try {
      const [loadedNote, loadedPractice, journal] = await Promise.all([
        readOptionalPracticeNote(api.getPracticeNote, practiceId),
        api.getPractice(practiceId).catch(() => null),
        // 배우 일지(SOMA-720)가 있는 회차는 같은 일지 화면에서 보고 고친다. 못 읽으면 지금처럼 노트를 보인다.
        readOptionalJournal(api.getPracticeJournal, practiceId).catch(() => null),
      ]);
      if (revision !== loadRevision.current) return;
      if (journal) {
        router.replace({ pathname: '/journal', params: { practiceId, from: 'history' } });
        return;
      }
      setNote(loadedNote);
      // 노트가 열렸으면 분석이 끝난 것이다 — 「분석 끝나면 영상 바로 지우기」를 골랐다면 지금 지운다.
      if (loadedNote) void purgeVideoFileIfDue(practiceId).catch(() => undefined);
      setPractice(loadedPractice);
      if (!loadedNote) setError(t('note.none'));
    } catch {
      if (revision === loadRevision.current) setError(t('note.loadFail'));
    } finally {
      if (revision === loadRevision.current) setLoading(false);
    }
  }, [practiceId, router]);

  useEffect(() => {
    void load();
    return () => { loadRevision.current += 1; };
  }, [load]);

  // 대화를 마치고 돌아오면 버튼이 바뀌어야 하므로 포커스마다 다시 읽는다.
  const rootId = practice?.root_id;
  useFocusEffect(
    useCallback(() => {
      if (!rootId) return;
      let alive = true;
      api
        .getPracticeGroup(rootId)
        .then((loaded) => {
          if (alive) setGroup(loaded);
        })
        .catch(() => undefined);
      return () => {
        alive = false;
      };
    }, [rootId]),
  );

  const action = continueActionFor(group);

  /** 열린 테이크면 그 대화로, 아니면 같은 묶음의 다음 회차로(영상은 새로 고른다). */
  const continuePractice = () => {
    if (action.kind === 'resume') {
      router.push({ pathname: '/coach', params: { practiceId: action.practiceId } });
      return;
    }
    if (!practice) {
      void alert({ title: t(continueActionLabel(action)), message: t('note.loadFail') });
      return;
    }
    setContinueOrigin({ kind: 'group', rootId: practice.root_id, practiceId: practice.id });
    router.push('/upload');
  };

  const fallbackNotice = note ? noteFallbackNotice(note) : null;
  const title = noteTitle(note, practice?.scene.situation?.trim() || t('history.noSceneTitle'));

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: t('note.title'), headerShadowVisible: false }} />
      {loading && (
        <View style={styles.center}>
          <ActivityIndicator color={palette.blue} />
        </View>
      )}
      {!loading && !note && <Text style={styles.error}>{error ?? t('note.none')}</Text>}
      {!loading && error === t('note.loadFail') && (
        <Pressable onPress={() => void load()} accessibilityRole="button">
          <Text style={styles.label}>{t('common.retry')}</Text>
        </Pressable>
      )}
      {note && (
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.heading}>
            <Text style={styles.kind}>{noteKindLabel(note.kind)}</Text>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.date}>{formatKoreanDate(note.created_at, { month: 'long', day: 'numeric' })}</Text>
            {fallbackNotice && <Text style={styles.fallback}>{fallbackNotice}</Text>}
          </View>

          <NoteSections note={note} />

          {/* 지난 노트에서도 평가를 남기고 고친다 — 초기값은 이미 남긴 평가다(practice.note). */}
          {practiceId && <ReportRating practiceId={practiceId} initial={note.my_rating} key={note.id} />}

          <Pressable style={styles.primary} onPress={continuePractice} accessibilityRole="button">
            <Text style={styles.primaryText}>{t(continueActionLabel(action))}</Text>
          </Pressable>
        </ScrollView>
      )}
      {dialog}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  center: { paddingVertical: 48, alignItems: 'center' },
  error: { color: palette.danger, textAlign: 'center', paddingVertical: 24 },
  body: { padding: 20, paddingBottom: 48, gap: 20 },
  heading: { gap: 6 },
  kind: { fontSize: 12, fontWeight: '800', color: palette.blue },
  title: { fontSize: 23, fontWeight: '900', color: palette.text, lineHeight: 33 },
  date: { fontSize: 12.5, fontWeight: '600', color: palette.textFaint },
  fallback: { fontSize: 12.5, fontWeight: '700', color: palette.amber },
  label: { fontSize: 12, fontWeight: '800', color: palette.textDim },
  primary: {
    height: 52,
    borderRadius: 14,
    backgroundColor: palette.blue,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  primaryText: { fontSize: 15, fontWeight: '900', color: palette.bg },
});
