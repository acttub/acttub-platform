import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
import { ReportRating } from '@/components/report-rating';
import { palette } from '@/constants/palette';
import { api } from '@/lib/api';
import { formatKoreanDate } from '@/lib/format';
import { translate as t } from '@/lib/i18n';
import { noteFallbackNotice, noteKindLabel, noteSections, noteTitle, quoteSourceLabel, readOptionalPracticeNote } from '@/lib/practice/note';
import { setContinueOrigin } from '@/lib/practice/session-state';
import type { PracticeDetail, PracticeNote } from '@/lib/practice/types';

/**
 * A12 지난 연습 노트 — 기록에서 회차를 누르면 열린다.
 *
 * 회차 id 로 노트를 읽는다(practice.note). 영상이 파기된 뒤에도 노트는 열린다. 여기서 이어가면
 * 같은 영상으로 같은 묶음의 다음 회차를 만들고, 장면은 비운 채 시작한다(practice.resume).
 */
export default function ReportDetailScreen() {
  const router = useRouter();
  const { practiceId } = useLocalSearchParams<{ practiceId?: string }>();
  const [note, setNote] = useState<PracticeNote | null>(null);
  const [practice, setPractice] = useState<PracticeDetail | null>(null);
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
      const [loadedNote, loadedPractice] = await Promise.all([
        readOptionalPracticeNote(api.getPracticeNote, practiceId),
        api.getPractice(practiceId).catch(() => null),
      ]);
      if (revision !== loadRevision.current) return;
      setNote(loadedNote);
      setPractice(loadedPractice);
      if (!loadedNote) setError(t('note.none'));
    } catch {
      if (revision === loadRevision.current) setError(t('note.loadFail'));
    } finally {
      if (revision === loadRevision.current) setLoading(false);
    }
  }, [practiceId]);

  useEffect(() => {
    void load();
    return () => { loadRevision.current += 1; };
  }, [load]);

  /** 같은 묶음의 다음 회차로. 그 회차의 영상을 그대로 쓴다. */
  const continuePractice = () => {
    if (!practice) {
      void alert({ title: t('history.continueCta'), message: t('note.loadFail') });
      return;
    }
    setContinueOrigin(practice.video_id
      ? { kind: 'history', rootId: practice.root_id, practiceId: practice.id, videoId: practice.video_id }
      : { kind: 'group', rootId: practice.root_id, practiceId: practice.id });
    router.push('/upload');
  };

  const sections = note ? noteSections(note) : [];
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

          {sections.map((section) => (
            <View style={styles.section} key={section.kind}>
              {!!section.label && <Text style={styles.label}>{section.label}</Text>}
              {section.kind === 'summary' ? (
                section.quotes.length > 0 ? (
                  section.quotes.map((quote, index) => (
                    <View style={styles.quote} key={`${index}-${quote.quote.slice(0, 8)}`}>
                      <Text style={styles.quoteText}>{quote.quote}</Text>
                      <Text style={styles.quoteSource}>{quoteSourceLabel(quote.kind)}</Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.text}>{section.text}</Text>
                )
              ) : (
                <Text style={[styles.text, section.kind === 'next' && styles.next, section.kind === 'cheer' && styles.cheer]}>
                  {section.text}
                </Text>
              )}
            </View>
          ))}

          {/* 지난 노트에서도 평가를 남기고 고친다 — 초기값은 이미 남긴 평가다(practice.note). */}
          {practiceId && <ReportRating practiceId={practiceId} initial={note.my_rating} key={note.id} />}

          <Pressable style={styles.primary} onPress={continuePractice} accessibilityRole="button">
            <Text style={styles.primaryText}>{t('history.continueCta')}</Text>
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
  section: { borderTopWidth: 1, borderTopColor: palette.borderSoft, paddingTop: 16, gap: 8 },
  label: { fontSize: 12, fontWeight: '800', color: palette.textDim },
  text: { fontSize: 16, lineHeight: 26, color: palette.text },
  next: { fontSize: 18, fontWeight: '700', lineHeight: 29 },
  cheer: { fontSize: 14, lineHeight: 23, color: palette.textDim },
  quote: { gap: 4, backgroundColor: palette.bgSubtle, borderRadius: 12, padding: 14 },
  quoteText: { fontSize: 15.5, lineHeight: 25, color: palette.text },
  quoteSource: { fontSize: 11.5, fontWeight: '800', color: palette.textFaint },
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
