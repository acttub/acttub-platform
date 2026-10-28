import Feather from '@expo/vector-icons/Feather';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KeyboardAwareScroll } from '@/components/keyboard-aware-scroll';
import { PrimaryButton } from '@/components/ui/buttons';
import { CtaBar } from '@/components/ui/cta-bar';
import { KeyboardLift } from '@/components/keyboard-lift';
import { palette } from '@/constants/palette';
import { useReadableNote } from '@/hooks/use-readable-input';
import { InlineErrorLine } from '@/components/ui/inline-error';
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
  // 허용 글자 범위(SOMA-922) — 대사·작품·배역은 loose, 메모는 strict.
  const looseNote = useReadableNote('loose');
  const strictNote = useReadableNote();
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
        <Pressable onPress={back} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('common.back')} ph-label="line_new_back">
          <Feather name={step === 0 ? 'x' : 'chevron-left'} size={26} color={palette.text} />
        </Pressable>
        <View style={styles.dots}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={[styles.dot, i === step && styles.dotOn]} />
          ))}
        </View>
        <Text style={styles.stepText}>{t('lineNew.stepLabel', { step: step + 1 })}</Text>
      </View>

      {/* 키보드가 뜨면 「다음」 버튼까지 키보드 위로 올린다 — iOS에서 아래 버튼이 키보드에 가렸다. */}
      <KeyboardLift aboveSafeBottom>
      <KeyboardAwareScroll contentContainerStyle={styles.content}>
        {step === 0 && (
          <>
            <Text style={styles.title}>{t('lineNew.title1')}</Text>
            <Text style={styles.sub}>{t('lineNew.sub1')}</Text>
            <TextInput
              style={styles.lineInput}
              placeholder={t('lineNew.linePh')}
              placeholderTextColor={palette.textFaint}
              value={draft.line}
              onChangeText={looseNote.wrap((line) => set({ line }))}
              multiline
              autoFocus
              textAlignVertical="top"
            />
            {looseNote.hint ? <InlineErrorLine message={looseNote.hint} /> : null}
            <Text style={styles.counter}>{t('lineNew.counter', { count: [...normalizeChallengeLine(draft.line)].length, max: LINE_MAX })}</Text>
            <View style={styles.hintRow}>
              <Feather name="zap" size={13} color={palette.blue} />
              <Text style={styles.hint}>{t('lineNew.hint1')}</Text>
            </View>
          </>
        )}

        {step === 1 && (
          <>
            <Text style={styles.title}>{t('lineNew.title2')}</Text>
            <Text style={styles.sub}>{t('lineNew.sub2')}</Text>
            <Text style={styles.fieldLabel}>{t('lineNew.workLabel')}</Text>
            <TextInput
              style={styles.input}
              placeholder={t('lineNew.workPh')}
              placeholderTextColor={palette.textFaint}
              value={draft.work}
              onChangeText={looseNote.wrap((work) => set({ work }))}
              autoFocus
            />
            <Text style={styles.fieldLabel}>{t('lineNew.roleLabel')}</Text>
            <TextInput
              style={styles.input}
              placeholder={t('lineNew.rolePh')}
              placeholderTextColor={palette.textFaint}
              value={draft.character}
              onChangeText={looseNote.wrap((character) => set({ character }))}
            />
            <Text style={styles.fieldLabel}>{t('lineNew.noteLabel')}</Text>
            <TextInput
              style={[styles.input, styles.noteInput]}
              placeholder={t('lineNew.notePh')}
              placeholderTextColor={palette.textFaint}
              value={draft.sceneNote}
              onChangeText={strictNote.wrap((sceneNote) => set({ sceneNote }))}
              multiline
              textAlignVertical="top"
            />
            {(looseNote.hint || strictNote.hint) ? <InlineErrorLine message={(looseNote.hint || strictNote.hint) as string} /> : null}
          </>
        )}

        {step === 2 && (
          <>
            <Text style={styles.title}>{t('lineNew.title3New')}</Text>
            <Text style={styles.sub}>{t('lineNew.sub3New')}</Text>
            <View style={styles.durationRow}>
              {CHALLENGE_DURATIONS.map((days) => (
                <Pressable
                  key={days}
                  style={[styles.duration, draft.durationDays === days && styles.durationOn]}
                  onPress={() => set({ durationDays: days as ChallengeDuration })}
                  accessibilityRole="button"
                  accessibilityState={{ selected: draft.durationDays === days }}>
                  <Text style={[styles.durationText, draft.durationDays === days && styles.durationTextOn]}>
                    {t(days === 7 ? 'lineNew.duration7' : 'lineNew.duration14')}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.preview}>
              <Text style={styles.previewLine}>{'\u201C'}{normalizeChallengeLine(draft.line)}{'\u201D'}</Text>
              <Text style={styles.previewMeta}>
                {[draft.work.trim(), draft.character.trim()].filter(Boolean).join(' \u00B7 ')}
              </Text>
              {!!draft.sceneNote.trim() && <Text style={styles.previewNote}>{draft.sceneNote.trim()}</Text>}
            </View>
          </>
        )}

        {!!overflow && <Text style={styles.error}>{t('lineNew.errInvalid')}</Text>}
        {!!error && <Text style={styles.error}>{error}</Text>}
      </KeyboardAwareScroll>

      <CtaBar safeBottom={false}>
        <PrimaryButton
          label={step === 2 ? t('lineNew.submit') : t('lineNew.next')}
          onPress={next}
          disabled={!canNext}
          loading={submitting}
        />
      </CtaBar>
      </KeyboardLift>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  // iOS 모달(pageSheet)은 위 안전 영역이 0이라 SafeAreaView만으로는 닫기 버튼이 시트 위 끝에 붙는다.
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 16 },
  dots: { flex: 1, flexDirection: 'row', gap: 6, justifyContent: 'center', alignItems: 'center' },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: palette.border },
  dotOn: { width: 18, backgroundColor: palette.blue },
  stepText: { fontSize: 12.5, fontWeight: '700', color: palette.textFaint },
  fieldLabel: { fontSize: 12.5, fontWeight: '800', color: palette.textMuted, marginTop: 10 },
  content: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 40, gap: 10 },
  title: { fontSize: 24, fontWeight: '900', color: palette.text, lineHeight: 34 },
  sub: { fontSize: 14, color: palette.textDim, lineHeight: 22, paddingBottom: 6 },
  label: { fontSize: 17, fontWeight: '800', color: palette.text, marginTop: 18 },
  lineInput: {
    minHeight: 120,
    borderRadius: 14,
    backgroundColor: palette.bgSoft,
    padding: 16,
    fontSize: 17,
    lineHeight: 26,
    color: palette.text,
  },
  input: { borderRadius: 12, backgroundColor: palette.bgSoft, padding: 14, fontSize: 15, color: palette.text },
  noteInput: { minHeight: 90 },
  counter: { fontSize: 12, color: palette.textFaint, textAlign: 'right' },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  hint: { fontSize: 12.5, color: palette.textFaint },
  durationRow: { flexDirection: 'row', gap: 10, paddingTop: 6 },
  duration: {
    flex: 1,
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  durationOn: { backgroundColor: palette.blueSoft, borderColor: palette.blue },
  durationText: { fontSize: 15, fontWeight: '700', color: palette.textDim },
  durationTextOn: { color: palette.blueDeep },
  preview: { backgroundColor: palette.bgSubtle, borderRadius: 14, padding: 16, gap: 6, marginTop: 14 },
  previewLine: { fontSize: 16, fontWeight: '800', color: palette.text, lineHeight: 25 },
  previewMeta: { fontSize: 12.5, color: palette.textMuted },
  previewNote: { fontSize: 12.5, color: palette.textFaint, lineHeight: 19 },
  error: { fontSize: 13.5, fontWeight: '700', color: palette.danger, marginTop: 8 },
});
