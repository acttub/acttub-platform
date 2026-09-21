import Feather from '@expo/vector-icons/Feather';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
import { KeyboardAwareScroll } from '@/components/keyboard-aware-scroll';
import { palette } from '@/constants/palette';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import {
  attemptFor,
  buildCreateBody,
  createFailure,
  createFailureMessage,
  draftOverflow,
  emptyChallengeDraft,
  fingerprintOf,
  stepComplete,
  type ChallengeDraft,
  type CreateAttempt,
} from '@/lib/challenge/create';
import {
  CHALLENGE_DURATIONS,
  CHARACTER_MAX,
  LINE_MAX,
  SCENE_NOTE_MAX,
  WORK_MAX,
  type ChallengeDuration,
} from '@/lib/challenge/types';
import { translate as t } from '@/lib/i18n';
import { newRequestId } from '@/lib/request-id';

/**
 * A16.2 새 대사 등록(challenge.create) — 세 단계(대사 → 작품·인물·메모 → 기간)를 한 요청으로 만든다.
 *
 * 개설한 사람은 자동으로 참여하지 않고, 공개 뒤에는 대사·작품·기간을 고칠 수 없다. 같은 시도를
 * 다시 보내면 같은 요청 id 라 챌린지는 하나다. 같은 대사로 진행 중 챌린지가 있으면 중복이고,
 * 하루 세 개를 넘기면 한도다. 글자 수는 서버와 같은 코드 포인트로 센다.
 */
export default function LineNewScreen() {
  const router = useRouter();
  const { alert, dialog } = useAppDialog();
  const params = useLocalSearchParams<{ line?: string }>();
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [draft, setDraft] = useState<ChallengeDraft>({ ...emptyChallengeDraft, line: params.line ?? '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attemptRef = useRef<CreateAttempt | null>(null);
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
      await alert({
        title: t('lineNew.doneTitleNew'),
        message: t('lineNew.doneMessageNew'),
        confirmLabel: t('common.confirm'),
      });
      router.replace({ pathname: '/challenge-detail', params: { id: challenge.id } });
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
    if (step < 2) {
      setStep((s) => (s + 1) as 0 | 1 | 2);
      return;
    }
    void submit();
  };
  const back = () => (step > 0 ? setStep((s) => (s - 1) as 0 | 1 | 2) : router.back());

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable onPress={back} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('common.back')}>
          <Feather name={step === 0 ? 'x' : 'chevron-left'} size={26} color={palette.text} />
        </Pressable>
        <View style={styles.dots}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={[styles.dot, i === step && styles.dotOn]} />
          ))}
        </View>
        <Text style={styles.stepText}>{t('lineNew.stepLabel', { step: step + 1 })}</Text>
      </View>

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
              onChangeText={(line) => set({ line })}
              maxLength={LINE_MAX}
              multiline
              autoFocus
              textAlignVertical="top"
            />
            <Text style={styles.counter}>{t('lineNew.counter', { count: [...draft.line].length, max: LINE_MAX })}</Text>
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
            <Text style={styles.label}>{t('lineNew.workLabel')}</Text>
            <TextInput
              style={styles.input}
              placeholder={t('lineNew.workPh')}
              placeholderTextColor={palette.textFaint}
              value={draft.work}
              onChangeText={(work) => set({ work })}
              maxLength={WORK_MAX}
            />
            <Text style={styles.label}>{t('lineNew.roleLabel')}</Text>
            <TextInput
              style={styles.input}
              placeholder={t('lineNew.rolePh')}
              placeholderTextColor={palette.textFaint}
              value={draft.character}
              onChangeText={(character) => set({ character })}
              maxLength={CHARACTER_MAX}
            />
            <Text style={styles.label}>{t('lineNew.noteLabel')}</Text>
            <TextInput
              style={[styles.input, styles.noteInput]}
              placeholder={t('lineNew.notePh')}
              placeholderTextColor={palette.textFaint}
              value={draft.sceneNote}
              onChangeText={(sceneNote) => set({ sceneNote })}
              maxLength={SCENE_NOTE_MAX}
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
              <Text style={styles.previewLine}>“{draft.line.trim()}”</Text>
              <Text style={styles.previewMeta}>
                {[draft.work.trim(), draft.character.trim()].filter(Boolean).join(' · ')}
              </Text>
              {!!draft.sceneNote.trim() && <Text style={styles.previewNote}>{draft.sceneNote.trim()}</Text>}
            </View>
          </>
        )}

        {!!overflow && <Text style={styles.error}>{t('lineNew.errInvalid')}</Text>}
        {!!error && <Text style={styles.error}>{error}</Text>}
      </KeyboardAwareScroll>

      <View style={styles.footer}>
        <Pressable
          style={[styles.cta, (!canNext || submitting) && styles.ctaOff]}
          onPress={next}
          disabled={!canNext || submitting}
          accessibilityRole="button">
          {submitting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.ctaText}>{t(step === 2 ? 'lineNew.submit' : 'lineNew.next')}</Text>
          )}
        </Pressable>
      </View>
      {dialog}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 6, gap: 12 },
  dots: { flex: 1, flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: palette.border },
  dotOn: { backgroundColor: palette.blue, width: 18 },
  stepText: { fontSize: 12.5, fontWeight: '700', color: palette.textFaint },
  content: { padding: 20, paddingBottom: 40, gap: 10 },
  title: { fontSize: 24, fontWeight: '900', color: palette.text, lineHeight: 34 },
  sub: { fontSize: 14, color: palette.textDim, lineHeight: 22, marginBottom: 6 },
  label: { fontSize: 12.5, fontWeight: '800', color: palette.textMuted, marginTop: 10 },
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
  durationRow: { flexDirection: 'row', gap: 10, marginTop: 6 },
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
  footer: { padding: 16, borderTopWidth: 1, borderTopColor: palette.borderSoft },
  cta: { height: 52, borderRadius: 14, backgroundColor: palette.blue, alignItems: 'center', justifyContent: 'center' },
  ctaOff: { backgroundColor: '#C9D3DF' },
  ctaText: { fontSize: 15, fontWeight: '900', color: '#FFFFFF' },
});
