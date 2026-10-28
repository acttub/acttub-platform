import Feather from '@expo/vector-icons/Feather';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { BackHandler, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KeyboardAwareScroll } from '@/components/keyboard-aware-scroll';
import { PrimaryButton } from '@/components/ui/buttons';
import { Chip } from '@/components/ui/chip';
import { CtaBar } from '@/components/ui/cta-bar';
import { InlineErrorLine } from '@/components/ui/inline-error';
import { StepHeader } from '@/components/ui/step-header';
import { TextField } from '@/components/ui/text-field';
import { KeyboardLift } from '@/components/keyboard-lift';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import {
  buildCreateBody,
  createFailure,
  createFailureMessage,
  draftOverflow,
  normalizeChallengeLine,
  emptyChallengeDraft,
  fingerprintOf,
  stepComplete,
  type ChallengeDraft,
} from '@/lib/challenge/create';
import {
  CHALLENGE_DURATIONS,
  LINE_MAX,
  type ChallengeDuration,
} from '@/lib/challenge/types';
import { translate as t } from '@/lib/i18n';
import { attemptFor, newRequestId, type RequestAttempt } from '@/lib/request-id';

/**
 * A16.2 새 대사 등록(challenge.create, pen C4.x) — 세 단계(대사 → 작품·인물·메모 → 기간)를 한 요청으로 만든다.
 *
 * 개설한 사람은 자동으로 참여하지 않고, 공개 뒤에는 대사·작품·기간을 고칠 수 없다. 같은 시도를
 * 다시 보내면 같은 요청 id 라 챌린지는 하나다. 같은 대사로 진행 중 챌린지가 있으면 중복이고,
 * 하루 세 개를 넘기면 한도다. 글자 수는 서버와 같은 코드 포인트로 센다.
 */
export default function LineNewScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ line?: string }>();
  const [draft, setDraft] = useState<ChallengeDraft>({ ...emptyChallengeDraft, line: params.line ?? '' });
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attemptRef = useRef<RequestAttempt | null>(null);
  const lockRef = useRef(false);

  const set = (patch: Partial<ChallengeDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const overflow = draftOverflow(draft);
  const canNext = stepComplete(draft, step);

  const submit = async () => {
    if (lockRef.current || submitting) return;
    lockRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const body = buildCreateBody('pending', draft);
      const attempt = attemptFor(attemptRef.current, fingerprintOf(body), newRequestId);
      attemptRef.current = attempt;
      const challenge = await api.createChallenge({ ...body, request_id: attempt.requestId });
      logEvent('challenge_created', { duration: draft.durationDays });
      // 등록 완료는 대화상자 대신 상세 아래 어두운 안내줄(C4.7)로 알린다.
      router.replace({ pathname: '/challenge-detail', params: { id: challenge.id, opened: '1' } });
    } catch (e) {
      const failure = createFailure(e);
      // 같은 id 에 다른 본문이면 id 를 버리고 다음 시도에서 새로 만든다.
      if (failure.kind === 'fingerprint_mismatch') attemptRef.current = null;
      setError(createFailureMessage(failure));
    } finally {
      lockRef.current = false;
      setSubmitting(false);
    }
  };

  const next = () => {
    if (!canNext) return;
    if (step < 2) setStep((step + 1) as 1 | 2);
    else void submit();
  };
  const back = () => {
    if (step > 0) setStep((step - 1) as 0 | 1);
    else router.back();
  };

  // 안드로이드 뒤로 키도 앞 단계로 간다. 첫 단계에서는 OS 기본 동작(화면 닫기)에 맡긴다.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (step === 0) return false;
      setStep((step - 1) as 0 | 1);
      return true;
    });
    return () => sub.remove();
  }, [step]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header} testID="line-new-header">
        <StepHeader step={step + 1} total={3} onBack={back} />
      </View>

      {/* 키보드가 뜨면 「다음」 버튼까지 키보드 위로 올린다 — iOS에서 아래 버튼이 키보드에 가렸다. */}
      <KeyboardLift aboveSafeBottom>
      <KeyboardAwareScroll contentContainerStyle={styles.content}>
        {step === 0 && (
          <>
            <Text style={styles.title}>{t('lineNew.title1')}</Text>
            <Text style={styles.sub}>{t('lineNew.sub1')}</Text>
            <TextField
              style={styles.lineInput}
              placeholder={t('lineNew.linePh')}
              value={draft.line}
              onChangeText={(line) => set({ line })}
              charset="loose"
              accessibilityLabel={t('lineNew.title1')}
              multiline
              autoFocus
              textAlignVertical="top"
              error={overflow === 'line' ? t('lineNew.lineOverMax', { max: LINE_MAX }) : null}
            />
            <View style={styles.hintRow}>
              {overflow === 'line' ? (
                <View style={styles.fill} />
              ) : (
                <>
                  <Feather name="zap" size={14} color={palette.blue} />
                  <Text style={styles.hint}>{t('lineNew.hint1')}</Text>
                </>
              )}
              <Text style={[styles.counter, overflow === 'line' && styles.counterOver]}>
                {t('lineNew.counter', { count: [...normalizeChallengeLine(draft.line)].length, max: LINE_MAX })}
              </Text>
            </View>
          </>
        )}

        {step === 1 && (
          <>
            <Text style={styles.title}>{t('lineNew.title2')}</Text>
            <Text style={styles.sub}>{t('lineNew.sub2')}</Text>
            <TextField charset="loose" label={t('lineNew.workLabel')} placeholder={t('lineNew.workPh')} value={draft.work} onChangeText={(work) => set({ work })} autoFocus />
            <TextField charset="loose" label={t('lineNew.roleLabel')} placeholder={t('lineNew.rolePh')} value={draft.character} onChangeText={(character) => set({ character })} />
            <TextField
              label={t('lineNew.noteLabel')}
              placeholder={t('lineNew.notePh')}
              value={draft.sceneNote}
              onChangeText={(sceneNote) => set({ sceneNote })}
              multiline
              textAlignVertical="top"
            />
          </>
        )}

        {step === 2 && (
          <>
            <Text style={styles.title}>{t('lineNew.title3New')}</Text>
            <Text style={styles.sub}>{t('lineNew.sub3New')}</Text>
            <View style={styles.durationRow}>
              {CHALLENGE_DURATIONS.map((days) => (
                <Chip
                  key={days}
                  role="radio"
                  label={t(days === 7 ? 'lineNew.duration7' : 'lineNew.duration14')}
                  selected={draft.durationDays === days}
                  onPress={() => set({ durationDays: days as ChallengeDuration })}
                  style={styles.duration}
                />
              ))}
            </View>
            <View style={styles.preview}>
              <Text style={styles.previewLine}>{'\u201C'}{normalizeChallengeLine(draft.line)}{'\u201D'}</Text>
              <Text style={styles.previewMeta}>
                {[draft.work.trim(), draft.character.trim()].filter(Boolean).join(' \u00B7 ')}
              </Text>
              {!!draft.sceneNote.trim() && <Text style={styles.previewMeta}>{draft.sceneNote.trim()}</Text>}
            </View>
          </>
        )}

        {!!overflow && overflow !== 'line' && <InlineErrorLine message={t('lineNew.errInvalid')} />}
        {!!error && <InlineErrorLine message={error} />}
      </KeyboardAwareScroll>

      <CtaBar safeBottom={false}>
        <PrimaryButton
          label={step === 2 ? t('lineNew.submit') : t('lineNew.next')}
          onPress={next}
          disabled={!canNext}
          loading={submitting}
          loadingLabel={t('lineNew.submitting')}
        />
      </CtaBar>
      </KeyboardLift>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  // iOS 모달(pageSheet)은 위 안전 영역이 0이라 SafeAreaView만으로는 닫기 버튼이 시트 위 끝에 붙는다.
  header: { paddingTop: space[3] },
  content: { paddingHorizontal: space.gutter, paddingTop: space[5], paddingBottom: space[10], gap: space[3] },
  title: { ...type.title2, color: palette.text },
  sub: { ...type.caption, color: palette.textSub, paddingBottom: space[1] },
  lineInput: { minHeight: 120, paddingTop: space[3], paddingBottom: space[3] },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: space[1.5] },
  fill: { flex: 1 },
  hint: { ...type.caption, flex: 1, color: palette.textMeta },
  counter: { ...type.caption, color: palette.textMeta },
  counterOver: { color: palette.danger },
  durationRow: { flexDirection: 'row', gap: space[2] },
  duration: { flex: 1, borderRadius: radius.md, alignItems: 'center' },
  preview: { backgroundColor: palette.bgSubtle, borderRadius: radius.lg, padding: space[4], gap: space[1] },
  previewLine: { ...type.headline, color: palette.text },
  previewMeta: { ...type.caption, color: palette.textMeta },
});
