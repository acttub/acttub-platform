import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SceneFoldBody, SceneFoldLink, SceneSummary } from '@/components/practice-chrome';
import { ReportRating } from '@/components/report-rating';
import { palette } from '@/constants/palette';
import { useExitReview } from '@/hooks/use-exit-review';
import { api } from '@/lib/api';
import { translate as t } from '@/lib/i18n';
import { noteFallbackNotice, noteKindLabel, noteSections, noteTitle, quoteSourceLabel } from '@/lib/practice/note';
import { clearPractice, getPractice, setContinueOrigin } from '@/lib/practice/session-state';
import type { PracticeNote } from '@/lib/practice/types';

/**
 * A13 연습 노트(practice.note) — 대화가 끝난 그 회차의 기록.
 *
 * 순서는 짧은 대화 요약 → 다음 촬영에서 해볼 한 가지 → 응원 문구다. 제목은 초점 문구 원문이고,
 * 요약은 배우 말·관찰의 원문 발췌라 출처를 함께 보인다. 비교 기준과 확인을 강제하는 옛 카피는
 * 없앴다 — 노트는 그 회차만 말하고 이전 연습과 견주지 않는다. "다음 연습"은 방금 끝낸 이 회차의
 * 장면을 미리 채워 이어 간다(practice.resume).
 */
export default function ReportScreen() {
  const router = useRouter();
  // 마운트 때 한 번만 읽는다 — 마치기에서 clearPractice() 한 직후 다시 읽으면 null 이다.
  const [practice] = useState(() => getPractice());
  const exitReview = useExitReview('leave', 'report', practice?.practiceId);
  const [note, setNote] = useState<PracticeNote | null>(() => practice?.note ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!practice?.note);
  const [sceneOpen, setSceneOpen] = useState(false);
  const mountedRef = useRef(true);
  const sceneVideo = practice?.videoUri || practice?.playbackUrl || null;

  const loadNote = useCallback(async () => {
    if (!practice) {
      setError(t('report.noPractice'));
      setLoading(false);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const loaded = await api.getPracticeNote(practice.practiceId);
      if (!mountedRef.current) return;
      practice.note = loaded;
      setNote(loaded);
    } catch (e) {
      if (!mountedRef.current) return;
      // 404 는 대화가 짧아 노트를 만들지 않은 회차다(기존 갈래) — 오류가 아니라 없음이다.
      const status = e !== null && typeof e === 'object' ? (e as { status?: number }).status : null;
      setError(status === 404 ? t('note.none') : t('note.loadFail'));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [practice]);

  useEffect(() => {
    mountedRef.current = true;
    if (!practice?.note) void loadNote();
    return () => {
      mountedRef.current = false;
    };
  }, [loadNote, practice?.note]);

  /** A13 "다음 연습" — 방금 끝낸 회차에서만 이전 장면을 미리 채운다. */
  const nextPractice = () => {
    if (practice) {
      setContinueOrigin({
        kind: 'note',
        rootId: practice.rootId,
        practiceId: practice.practiceId,
        scene: practice.scene,
      });
    }
    clearPractice();
    router.dismissAll();
    router.push('/upload');
  };

  const finish = () => {
    void exitReview.offer(() => {
      clearPractice();
      router.dismissAll();
    });
  };

  const sections = note ? noteSections(note) : [];
  const fallbackNotice = note ? noteFallbackNotice(note) : null;
  const title = noteTitle(note, practice?.scene.situation.trim() || t('history.noSceneTitle'));

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: t('note.title'), headerBackVisible: false, headerShadowVisible: false }} />

      {loading && !note && (
        <View style={styles.center}>
          <ActivityIndicator color={palette.blue} size="large" />
          <Text style={styles.loadingText}>{t('report.making')}</Text>
        </View>
      )}

      {!loading && !note && (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error ?? t('note.none')}</Text>
          <Pressable style={styles.primary} onPress={() => void loadNote()}>
            <Text style={styles.primaryText}>{t('common.retry')}</Text>
          </Pressable>
          <Pressable style={styles.ghost} onPress={finish}>
            <Text style={styles.ghostText}>{t('common.goHome')}</Text>
          </Pressable>
        </View>
      )}

      {note && practice && (
        <>
          <View style={styles.statusRow}>
            <Text style={styles.kind}>{noteKindLabel(note.kind)}</Text>
            <SceneFoldLink open={sceneOpen} onToggle={() => setSceneOpen((was) => !was)} label={t('blockage.sceneFold')} />
          </View>
          <SceneFoldBody open={sceneOpen} videoUri={sceneVideo} />
          {sceneOpen && (
            <View style={styles.sceneSummary}>
              <SceneSummary scene={practice.scene} blockage={null} />
            </View>
          )}
          <ScrollView contentContainerStyle={styles.body}>
            <View style={styles.heading}>
              <Text style={styles.title}>{title}</Text>
              {fallbackNotice && <Text style={styles.fallback}>{fallbackNotice}</Text>}
            </View>

            {sections.map((section) => (
              <View style={styles.section} key={section.kind}>
                {!!section.label && <Text style={styles.label}>{section.label}</Text>}
                {section.kind === 'summary' ? (
                  section.quotes.length > 0 ? (
                    section.quotes.map((quote, index) => (
                      <View style={styles.quote} key={`${index}-${quote.text.slice(0, 8)}`}>
                        <Text style={styles.quoteText}>{quote.text}</Text>
                        <Text style={styles.quoteSource}>{quoteSourceLabel(quote.source)}</Text>
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

            {/* 회차 맥락이 붙은 미니 평가 — 👍/👎 + 한 줄(선택). 이탈 설문과 다른 기능이다. */}
            <ReportRating sessionId={practice.practiceId} />

            <View style={styles.buttonRow}>
              <Pressable style={styles.primary} onPress={nextPractice}>
                <Text style={styles.primaryText}>{t('note.nextPractice')}</Text>
              </Pressable>
              <Pressable style={styles.ghost} onPress={finish}>
                <Text style={styles.ghostText}>{t('note.finish')}</Text>
              </Pressable>
            </View>
          </ScrollView>
        </>
      )}
      {exitReview.element}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 28 },
  loadingText: { fontSize: 14, fontWeight: '600', color: palette.textFaint, textAlign: 'center' },
  errorText: { fontSize: 14, fontWeight: '700', color: palette.danger, textAlign: 'center' },

  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  kind: { fontSize: 12, fontWeight: '800', color: palette.blue },
  sceneSummary: { paddingHorizontal: 20, paddingBottom: 8 },

  body: { paddingHorizontal: 20, paddingBottom: 40, gap: 22 },
  heading: { gap: 8 },
  title: { fontSize: 24, fontWeight: '900', color: palette.text, lineHeight: 34 },
  fallback: { fontSize: 12.5, fontWeight: '700', color: palette.amber },

  section: { borderTopWidth: 1, borderTopColor: palette.borderSoft, paddingTop: 16, gap: 8 },
  label: { fontSize: 12, fontWeight: '800', color: palette.textDim },
  text: { fontSize: 16, lineHeight: 26, color: palette.text },
  next: { fontSize: 18, fontWeight: '700', lineHeight: 29 },
  cheer: { fontSize: 14, lineHeight: 23, color: palette.textDim },
  quote: { gap: 4, backgroundColor: palette.bgSubtle, borderRadius: 12, padding: 14 },
  quoteText: { fontSize: 15.5, lineHeight: 25, color: palette.text },
  quoteSource: { fontSize: 11.5, fontWeight: '800', color: palette.textFaint },

  buttonRow: { gap: 10, marginTop: 8 },
  primary: { height: 52, borderRadius: 14, backgroundColor: palette.blue, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontSize: 15, fontWeight: '900', color: palette.bg },
  ghost: {
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostText: { fontSize: 15, fontWeight: '800', color: palette.textDim },
});
