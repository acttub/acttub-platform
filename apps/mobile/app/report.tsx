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
import { MASCOT } from '@/components/ui/mascot';
import { StatusScreen } from '@/components/ui/status-screen';
import { NoticeBand } from '@/components/ui/notice-band';
import { palette } from '@/constants/palette';
import { space, type } from '@/constants/tokens';
import { useAppRating } from '@/hooks/use-app-rating';
import { api } from '@/lib/api';
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
/** 노트를 보일 수 없는 까닭. 화면은 셋 모두 StatusScreen 에 아래 바 「홈으로」 위 · 「다시 시도」 아래다. */
// 진행 중 회차가 없으면 다시 읽어도 같으므로 「다시 시도」 없이 「홈으로」만 둔다.
type NoteProblem = 'no_practice' | 'none' | 'load_fail';
const NOTE_PROBLEM: Record<NoteProblem, { title: string; body: string; mascot: 'dizzy' | 'coach'; retry: boolean }> = {
  no_practice: { title: 'report.noPracticeTitle', body: 'report.noPracticeBody', mascot: 'coach', retry: false },
  none: { title: 'note.noneTitle', body: 'note.noneBody', mascot: 'coach', retry: true },
  load_fail: { title: 'note.loadFailTitle', body: 'note.loadFailBody', mascot: 'dizzy', retry: true },
};

export default function ReportScreen() {
  const router = useRouter();
  // 코칭을 노트·일지·마무리까지 가 봤으면 첫 사용자 화면은 졸업이다(SOMA-827).
  useEffect(() => {
    void markFirstUseGraduated();
  }, []);
  // 마운트 때 한 번만 읽는다 — 마치기에서 clearPractice() 한 직후 다시 읽으면 null 이다.
  const [practice] = useState(() => getPractice());
  const rating = useAppRating();
  const [note, setNote] = useState<PracticeNote | null>(() => practice?.note ?? null);
  const [error, setError] = useState<NoteProblem | null>(null);
  // 노트도 오류도 아직 없으면 읽는 중이다.
  const loading = !note && !error;
  const [sceneOpen, setSceneOpen] = useState(false);
  const mountedRef = useRef(true);
  const sceneVideo = practice?.videoUri || practice?.playbackUrl || null;

  const loadNote = useCallback(async () => {
    if (!practice) {
      setError('no_practice');
      return;
    }
    setError(null);
    try {
      const loaded = await readOptionalPracticeNote(api.getPracticeNote, practice.practiceId);
      if (!mountedRef.current) return;
      practice.note = loaded;
      setNote(loaded);
      if (!loaded) setError('none');
    } catch {
      if (mountedRef.current) setError('load_fail');
    }
  }, [practice]);

  useEffect(() => {
    mountedRef.current = true;
    if (!practice?.note) void loadNote();
    return () => {
      mountedRef.current = false;
    };
  }, [loadNote, practice?.note]);

  /** A13 「다음 테이크 찍기」(말로 한 회차는 「영상 찍어 코칭받기」) — 방금 끝낸 회차에서만 이전 장면을 미리 채운다. 영상은 새로 고른다(SOMA-672). */
  const nextTake = () => {
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
        <StatusScreen
          mascot={MASCOT[NOTE_PROBLEM[error].mascot]}
          title={t(NOTE_PROBLEM[error].title)}
          body={t(NOTE_PROBLEM[error].body)}
          primary={
            NOTE_PROBLEM[error].retry
              ? { label: t('common.retry'), onPress: () => void loadNote(), phLabel: 'report_retry' }
              : { label: t('common.goHome'), onPress: finish, phLabel: 'report_go_home' }
          }
          // 이 화면은 머리에 뒤로가 없어 집으로 갈 길을 버튼으로 남긴다.
          secondary={NOTE_PROBLEM[error].retry ? { label: t('common.goHome'), onPress: finish, phLabel: 'report_go_home' } : undefined}
        />
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
            <AdSlot slot="report_top" style={styles.ad} />
            <View style={styles.heading}>
              <Text style={styles.title}>{title}</Text>
              {fallbackNotice && (
                <NoticeBand compact icon="alert-circle" message={fallbackNotice}/>
              )}
            </View>

            <NoteSections note={note} />

            {/* 노트 평가 — 누르는 순간 서버에 저장하고 한 줄(선택)을 덧붙인다. 이탈 설문과 다른 기능이다. */}
            <ReportRating practiceId={practice.practiceId} initial={note.my_rating} key={note.id} />

            {rating.element}
          </ScrollView>
          {/* 저장하고 마치기·다음 테이크는 노트 길이와 상관없이 화면 아래에 붙여 둔다(pen OL9mWG, SOMA-770 피드백 14). */}
          <CtaBar safeBottom={false}>
            {/* 영상 없이 말로 한 회차는 다음 「테이크」가 없다 — 같은 장면을 영상으로 찍어 코칭받는 길을 둔다(SOMA-1051). */}
            <SecondaryButton label={t(sceneVideo ? 'history.nextTake' : 'note.recordForCoach')} onPress={nextTake} />
            <PrimaryButton label={t('note.saveFinish')} onPress={finish} />
          </CtaBar>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space[3], padding: space[6] },
  loadingText: { ...type.caption, color: palette.textSub, textAlign: 'center' },

  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.gutter,
    paddingBottom: space[2],
  },
  kind: { ...type.micro, color: palette.blueDeep },
  sceneSummary: { paddingHorizontal: space.gutter, paddingBottom: space[2] },

  body: { paddingTop: space[1], paddingHorizontal: space.gutter, paddingBottom: space[6], gap: space[3] },
  ad: { marginBottom: space[4] },
  heading: { gap: space[3] },
  title: { ...type.title2, color: palette.text },
});
