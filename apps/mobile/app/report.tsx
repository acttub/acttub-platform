import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AdSlot } from '@/components/ad-slot';
import { SceneFoldBody, SceneFoldLink, SceneSummary } from '@/components/practice-chrome';
import { NoteSections } from '@/components/note-sections';
import { ReportRating } from '@/components/report-rating';
import { PrimaryButton, SecondaryButton } from '@/components/ui/buttons';
import { CtaBar } from '@/components/ui/cta-bar';
import { palette } from '@/constants/palette';
import { useAppRating } from '@/hooks/use-app-rating';
import { useSpotlightTarget } from '@/hooks/use-spotlight-target';
import { finishTutorial, useTutorialSpotlight } from '@/hooks/use-tutorial-spotlight';
import { TARGET } from '@/lib/spotlight-targets';
import { loopApiFor } from '@/lib/tutorial-loop';
import { isSamplePracticeId } from '@/lib/tutorial-sample';
import { translate as t } from '@/lib/i18n';
import { noteFallbackNotice, noteKindLabel, noteSections, noteTitle, readOptionalPracticeNote } from '@/lib/practice/note';
import { clearPractice, getPractice, setContinueOrigin } from '@/lib/practice/session-state';
import type { PracticeNote } from '@/lib/practice/types';
import { markFirstUseGraduated } from '@/lib/practice/first-use-graduation';

/**
 * A13 연습 노트(practice.note) — 대화가 끝난 그 회차의 기록.
 *
 * 순서는 짧은 대화 요약 → 다음 촬영에서 해볼 한 가지 → 응원 문구다. 제목은 초점 문구 원문이고,
 * 요약은 배우 말·관찰의 원문 발췌라 출처를 함께 보인다. 비교 기준과 확인을 강제하는 옛 카피는
 * 없앴다 — 노트는 그 회차만 말하고 이전 연습과 견주지 않는다. "다음 연습"은 방금 끝낸 이 회차의
 * 장면을 미리 채워 이어 간다(practice.resume).
 *
 * 모양은 pen 「새 · 배우 일지 첫 연습」(SOMA-748). 「저장하고 마치기」는 코칭 마무리 화면(app/coaching-done)으로 간다.
 * 디자인의 「내가 발견한 것 · 직접 써요」 칸과 「다음 연습 날에 붙여 둘게요」 줄은 노트 수정·일정 API가 없어 두지 않는다.
 */
export default function ReportScreen() {
  const router = useRouter();
  // 코칭을 노트·일지·마무리까지 가 봤으면 첫 사용자 화면은 졸업이다(SOMA-827).
  useEffect(() => {
    void markFirstUseGraduated();
  }, []);
  // 마운트 때 한 번만 읽는다 — 마치기에서 clearPractice() 한 직후 다시 읽으면 null 이다.
  const [practice] = useState(() => getPractice());
  // 튜토리얼 예시(SOMA-494) — 노트는 미리 써 둔 것이고, 서버에 남는 것이 없다.
  const sample = isSamplePracticeId(practice?.practiceId);
  const noteTarget = useSpotlightTarget(TARGET.reportNote);
  const rating = useAppRating();
  const [note, setNote] = useState<PracticeNote | null>(() => practice?.note ?? null);
  const [error, setError] = useState<string | null>(null);
  // 노트도 오류도 아직 없으면 읽는 중이다.
  const loading = !note && !error;
  const [sceneOpen, setSceneOpen] = useState(false);
  const mountedRef = useRef(true);
  const sceneVideo = practice?.videoUri || practice?.playbackUrl || null;

  const loadNote = useCallback(async () => {
    if (!practice) {
      setError(t('report.noPractice'));
      return;
    }
    setError(null);
    try {
      const loaded = await readOptionalPracticeNote(loopApiFor(practice.practiceId).getPracticeNote, practice.practiceId);
      if (!mountedRef.current) return;
      practice.note = loaded;
      setNote(loaded);
      if (!loaded) setError(t('note.none'));
    } catch {
      if (mountedRef.current) setError(t('note.loadFail'));
    }
  }, [practice]);

  useEffect(() => {
    mountedRef.current = true;
    if (!practice?.note) void loadNote();
    return () => {
      mountedRef.current = false;
    };
  }, [loadNote, practice?.note]);

  const tutorialGuide = useTutorialSpotlight('report', { ready: !!note });

  // 예시를 다 돈 사람 — 이번엔 내 영상으로.
  const startOwn = () => {
    finishTutorial('done');
    clearPractice();
    router.dismissAll();
    router.push('/upload');
  };

  const finishSample = () => {
    finishTutorial('done');
    clearPractice();
    router.dismissAll();
  };

  /** A13 「다음 테이크 찍기」 — 방금 끝낸 회차에서만 이전 장면을 미리 채운다. 영상은 새로 고른다(SOMA-672). */
  const nextTake = () => {
    finishTutorial('done');
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
    if (sample) {
      finishSample();
      return;
    }
    finishTutorial('done');
    // AI 코칭을 마칠 때 — 두 번에 한 번(7일 간격·최대 3번) 앱 평가를 묻고 닫힌 뒤 나간다 (SOMA-494).
    const nextSection = note ? noteSections(note).find((section) => section.kind === 'next') : undefined;
    const next = nextSection?.kind === 'next' && nextSection.hasProposal ? nextSection.text : null;
    const leave = () => {
      clearPractice();
      router.dismissAll();
      // 노트를 본 뒤 마칠 때만 마무리 한 장을 보인다 — 노트를 못 읽어 홈으로 가는 길은 바로 홈이다.
      if (note) router.push({ pathname: '/coaching-done', params: next ? { next } : {} });
    };
    if (!practice) {
      leave();
      return;
    }
    void rating.after({ kind: 'coach', practiceId: practice.practiceId }, leave);
  };

  const fallbackNotice = note ? noteFallbackNotice(note) : null;
  const title = noteTitle(note, practice?.scene.situation.trim() || t('history.noSceneTitle'));

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: t('note.title'), headerBackVisible: false, headerLeft: () => null, headerShadowVisible: false }} />

      {loading && (
        <View style={styles.center}>
          <Text style={styles.loadingText}>{t('report.making')}</Text>
        </View>
      )}

      {error && !note && (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <PrimaryButton label={t('common.retry')} onPress={() => void loadNote()} style={styles.stretch} />
          <SecondaryButton label={t('common.goHome')} onPress={finish} style={styles.stretch} />
        </View>
      )}

      {note && practice && (
        <>
          <View style={styles.statusRow}>
            <Text style={styles.kind}>{noteKindLabel(note.kind)}</Text>
            <SceneFoldLink open={sceneOpen} onToggle={() => setSceneOpen((was) => !was)} label={t('blockage.sceneFold')} track="report" />
          </View>
          <SceneFoldBody open={sceneOpen} videoUri={sceneVideo} track="report" />
          {sceneOpen && (
            <View style={styles.sceneSummary}>
              <SceneSummary scene={practice.scene} blockage={null} />
            </View>
          )}
          <ScrollView contentContainerStyle={styles.body}>
            <AdSlot slot="report_top" style={{ marginBottom: 16 }} />
            <View ref={noteTarget.ref} onLayout={noteTarget.onLayout} style={styles.noteBlock}>
            <View style={styles.heading}>
              <Text style={styles.title}>{title}</Text>
              {fallbackNotice && <Text style={styles.fallback}>{fallbackNotice}</Text>}
            </View>

            <NoteSections note={note} />
            </View>

            {/* 노트 평가 — 누르는 순간 서버에 저장하고 한 줄(선택)을 덧붙인다. 이탈 설문과 다른 기능이다.
                튜토리얼 예시 노트는 서버에 없어 평가를 받지 않는다(SOMA-494). */}
            {!sample && <ReportRating practiceId={practice.practiceId} initial={note.my_rating} key={note.id} />}

            {rating.element}

            {sample ? (
              <View style={styles.sampleDone}>
                <Text style={styles.sampleDoneTitle}>{t('tutorial.sampleDone')}</Text>
                <Text style={styles.sampleDoneBody}>{t('tutorial.sampleDoneBody')}</Text>
                <View style={styles.buttonRow}>
                  <PrimaryButton label={t('tutorial.ownTitle')} onPress={startOwn} />
                  <SecondaryButton label={t('common.goHome')} onPress={finishSample} />
                </View>
              </View>
            ) : null}
          </ScrollView>
          {/* 저장하고 마치기·다음 테이크는 노트 길이와 상관없이 화면 아래에 붙여 둔다(pen OL9mWG, SOMA-770 피드백 14). */}
          {!sample && (
            <CtaBar safeBottom={false}>
              <PrimaryButton label={t('note.saveFinish')} onPress={finish} />
              <SecondaryButton label={t('history.nextTake')} onPress={nextTake} />
            </CtaBar>
          )}
        </>
      )}
      {tutorialGuide.element}
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
    paddingHorizontal: 24,
    paddingBottom: 10,
  },
  kind: { fontSize: 12, fontWeight: '800', color: palette.blue },
  sceneSummary: { paddingHorizontal: 20, paddingBottom: 8 },

  body: { paddingTop: 8, paddingHorizontal: 24, paddingBottom: 24, gap: 10 },
  heading: { gap: 8 },
  title: { fontSize: 22, fontWeight: '900', color: palette.text, lineHeight: 31 },
  fallback: { fontSize: 12.5, fontWeight: '700', color: palette.amber },

  buttonRow: { gap: 10, marginTop: 8 },
  // 스크롤 본문의 gap(섹션 사이)을 노트 안에서도 그대로 둔다 — 비추려고 한 번 감쌌을 뿐이다.
  noteBlock: { gap: 10 },
  sampleDone: {
    gap: 8,
    borderRadius: 20,
    backgroundColor: palette.blueMist,
    borderWidth: 1,
    borderColor: palette.blueLine,
    padding: 18,
  },
  sampleDoneTitle: { fontSize: 17, fontWeight: '800', color: palette.text },
  sampleDoneBody: { fontSize: 14, color: palette.textDim, lineHeight: 21, marginBottom: 6 },
  stretch: { alignSelf: 'stretch' },
});
