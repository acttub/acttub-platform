import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { afterVoicesSaved, currentTutorial } from '@/lib/tutorial';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton, SecondaryButton, TextButton } from '@/components/ui/buttons';
import { Chip } from '@/components/ui/chip';
import { CtaBar } from '@/components/ui/cta-bar';
import { MascotBubble } from '@/components/ui/mascot-bubble';
import { NavHeader, NavIconButton } from '@/components/ui/nav-header';
import { palette } from '@/constants/palette';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api-request';
import { useAuth } from '@/lib/auth';
import { translate as t } from '@/lib/i18n';
import { recordScriptFromCocreated, setRecordScript } from '@/lib/practice/record-script';
import { setContinueOrigin } from '@/lib/practice/session-state';
import { loadIntoCurrent } from '@/lib/reading/store';
import { newRequestId } from '@/lib/request-id';
import {
  ANY_EMOTION,
  ANY_SITUATION,
  CAST_OPTIONS,
  coachSceneFor,
  generateWithWait,
  myRole,
  EMOTIONS,
  errorKey,
  freeLeft,
  REVISION_CHIPS,
  type RevisionChip,
  experienceFor,
  FREE_TEXT_MAX,
  LENGTH_OPTIONS,
  revisionBody,
  revisionChanged,
  SITUATIONS,
  summaryLine,
  type ReviseSampleScriptBody,
  type SampleScript,
} from '@/lib/script-cocreate';

type Step = 'start' | 'failed' | 'emotion' | 'situation' | 'direction' | 'generating' | 'result' | 'edit' | 'saved';

/**
 * 찍을 대사부터 같이 만들기(SOMA-721, 코칭 탭 입구). 감정 → 상황 → 원하는 방향(선택)을 한 화면씩 묻고, 서버가 생성 대본을 만든다.
 * 결과는 대사를 읽기 쉬운 넓은 대본과 아래 「수정하기」·「이 대본으로 확정」 두 버튼이다(pen 「대본 같이 만들기 · 결과」,
 * 10/19 인계본). 확정하면 「내 대본」(리딩)에 저장되고, 「지금 찍을래요」는 이 대본의 장면 정보를 새 연습 장면 칸에 채워 찍는 법 →
 * 카메라 → 새 연습 준비로 간다. 「나중에 찍을게요」는 코칭 탭으로 돌아간다.
 *
 * 수정은 성공한 것만 무료 3번이다(서버가 센다). 다 쓰면 안내만 하고 결제·Pro 화면은 없다. 분량은 추정치라 「약 1분」으로 보인다.
 */
/** 대본 생성 결과를 기다리는 최대 시간과 다시 묻는 간격. */
const GENERATION_WAIT_MS = 180_000;
const GENERATION_POLL_MS = 5_000;

export default function ScriptCocreateScreen() {
  const router = useRouter();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const readingMode = mode === 'reading';
  const { profile } = useAuth();
  const me = profile.me?.profile ?? null;
  const [step, setStep] = useState<Step>(readingMode ? 'start' : 'emotion');
  const [startChoice, setStartChoice] = useState<'sample' | 'make' | null>(null);
  const [regenUsed, setRegenUsed] = useState(0);
  const regenPending = useRef(false);
  const [emotion, setEmotion] = useState<string | null>(null);
  const [situation, setSituation] = useState('');
  const [direction, setDirection] = useState('');
  const [characterCount, setCharacterCount] = useState<number>(readingMode ? 2 : 1);
  const [minutes, setMinutes] = useState<number>(1);
  const [script, setScript] = useState<SampleScript | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState({ text: '', characterCount: 1, minutes: 1 });

  const fail = (e: unknown) => setError(t(errorKey(e instanceof ApiError ? e.code : undefined)));

  const generation = useRef<{ payload: string; requestId: string } | null>(null);

  const generate = async () => {
    setError(null);
    setStep('generating');
    try {
      const body = {
        experience: experienceFor(me?.experience),
        age: me?.age ?? null,
        gender: me?.gender ?? null,
        goal: me?.goal ?? null,
        emotion,
        situation: situation.trim() || ANY_SITUATION,
        direction: direction.trim() || null,
        character_count: characterCount,
        length_minutes: minutes,
      };
      const payload = JSON.stringify(body);
      if (generation.current?.payload !== payload) {
        generation.current = { payload, requestId: newRequestId() };
      }
      const requestId = generation.current.requestId;
      // 받는 길이 먼저 끊겨도(웹 프록시 60초) 서버는 끝까지 만든다 — 같은 요청 id로 3분까지 다시 물어 받는다.
      const made = await generateWithWait(() => api.createSampleScript({ ...body, request_id: requestId }), {
        deadlineMs: GENERATION_WAIT_MS,
        intervalMs: GENERATION_POLL_MS,
      });
      generation.current = null; // 다음 의도적인 생성은 새 요청이다. 실패한 재시도만 같은 id를 쓴다.
      if (regenPending.current) {
        regenPending.current = false;
        setRegenUsed((n) => n + 1); // 성공한 다시 만들기만 센다. 실패한 시도는 빼 준다.
      }
      setScript(made);
      setStep('result');
    } catch (e) {
      fail(e);
      setStep('failed');
    }
  };

  // 다시 만들기 — 같은 입력으로 새로 요청한다. 무료 횟수를 다 썼으면 막는다.
  const regenerate = () => {
    if (!script || freeLeft(script.revisions_left, regenUsed) <= 0) return;
    generation.current = null;
    regenPending.current = true;
    void generate();
  };

  const openEdit = () => {
    if (!script) return;
    setError(null);
    setEdit({ text: '', characterCount: script.character_count, minutes: script.length_minutes });
    setStep('edit');
  };

  const applyEdit = () => {
    if (!script || !revisionChanged(script, edit)) return;
    return runRevision(revisionBody(script, edit));
  };

  // 수정 칩 — 칩 문구를 그 지시로 보내 고친 대본을 받는다.
  const reviseWithChip = (chip: RevisionChip) => {
    if (!script || busy || freeLeft(script.revisions_left, regenUsed) <= 0) return;
    const instruction = t(`scriptCocreate.chip${chip === 'shorter' ? 'Shorter' : chip === 'stronger' ? 'Stronger' : 'MoreMine'}Text`);
    return runRevision({ base_version: script.version, text: instruction });
  };

  const runRevision = async (revision: ReviseSampleScriptBody) => {
    if (!script) return;
    setBusy(true);
    setError(null);
    try {
      setScript(await api.reviseSampleScript(script.id, revision));
      setStep('result');
    } catch (e) {
      try {
        const latest = await api.getSampleScript(script.id);
        setScript(latest);
        if (latest.version_count > script.version_count || latest.version !== script.version || latest.script_id) {
          setStep('result');
          return; // 응답만 유실된 성공 또는 다른 기기의 최신 결과. 자동으로 다시 수정하지 않는다.
        }
        fail(e);
      } catch {
        // 결과가 불확실할 때 '원본 그대로'라고 단정하지 않는다.
        setError(t('scriptCocreate.errorConflict'));
      }
    } finally {
      setBusy(false);
    }
  };

  const restorePrevious = async () => {
    if (!script || script.version <= 1) return;
    setBusy(true);
    setError(null);
    try {
      setScript(await api.restoreSampleScript(script.id, script.version - 1));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!script) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await api.saveSampleScript(script.id);
      setScript({ ...script, script_id: saved.script_id });
      if (readingMode) {
        const loaded = await loadIntoCurrent(saved.script_id);
        if (!loaded) throw new Error('saved_script_not_found');
        router.replace('/reading/detail');
        if (afterVoicesSaved(true, currentTutorial()) === 'detail_then_range') router.push('/reading/range');
      } else {
        setStep('saved');
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  // 지금 찍기 — 장면 칸을 채워 두고 카메라 → 새 연습 준비(next=upload)로 간다.
  const recordNow = () => {
    if (!script) return;
    setContinueOrigin({ kind: 'reading', scene: coachSceneFor(script) });
    // 찍는 동안 대사를 볼 수 있게 촬영 화면에 대본 카드를 띄운다.
    setRecordScript(recordScriptFromCocreated(script, myRole(script)));
    router.replace({ pathname: '/record-video', params: { mode: 'ai', next: 'upload' } });
  };

  // 저장한 대본을 리딩 대본 화면으로 연다(리딩 탭 「업로드한 대본」에도 있는 그 대본).
  const openInReading = async () => {
    if (!script?.script_id) return;
    setBusy(true);
    setError(null);
    try {
      const loaded = await loadIntoCurrent(script.script_id);
      if (!loaded) throw new Error('saved_script_not_found');
      router.replace('/reading/detail');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const back = () => {
    if (step === 'emotion' && readingMode) return setStep('start');
    if (step === 'failed') return setStep('direction');
    if (step === 'situation') return setStep('emotion');
    if (step === 'direction') return setStep('situation');
    if (step === 'edit') return setStep('result');
    router.back();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <NavHeader
        title={t('scriptCocreate.title')}
        left={<NavIconButton icon="chevron-left" size={24} label={t('common.back')} phLabel="script_cocreate_back" onPress={back} />}
      />
      {step === 'generating' ? (
        <View style={styles.center}>
          <ActivityIndicator color={palette.blue} />
          <Text style={styles.waitTitle}>{t('scriptCocreate.generating')}</Text>
          <Text style={styles.waitSub}>{t('scriptCocreate.generatingSub')}</Text>
        </View>
      ) : step === 'result' && script ? (
        <View style={styles.flex}>
          <ScrollView contentContainerStyle={styles.resultBody}>
            <MascotBubble title={t('scriptCocreate.resultAsk')} guide={t('scriptCocreate.resultGuide')} />
            <ScriptPaper script={script} />
            <View style={styles.chips}>
              {REVISION_CHIPS.map((chip) => (
                <Chip
                  key={chip}
                  label={t(`scriptCocreate.chip${chip === 'shorter' ? 'Shorter' : chip === 'stronger' ? 'Stronger' : 'MoreMine'}`)}
                  phLabel="script_cocreate_chip"
                  disabled={busy || freeLeft(script.revisions_left, regenUsed) <= 0}
                  onPress={() => void reviseWithChip(chip)}
                />
              ))}
            </View>
            <TextButton
              label={`${t('scriptCocreate.regenerate')} · ${t('scriptCocreate.freeLeftOf', { count: freeLeft(script.revisions_left, regenUsed) })}`}
              phLabel="script_cocreate_regenerate"
              onPress={regenerate}
              disabled={busy || freeLeft(script.revisions_left, regenUsed) <= 0}
            />
            {script.version > 1 ? (
              <TextButton label={t('scriptCocreate.restore')} phLabel="script_cocreate_restore" onPress={restorePrevious} disabled={busy} />
            ) : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </ScrollView>
          <CtaBar divider>
            {freeLeft(script.revisions_left, regenUsed) <= 0 ? (
              <Text style={styles.left}>{t('scriptCocreate.errorRevisionLimit')}</Text>
            ) : null}
            <SecondaryButton
              label={t('scriptCocreate.edit')}
              phLabel="script_cocreate_edit"
              onPress={openEdit}
              disabled={busy || freeLeft(script.revisions_left, regenUsed) <= 0}
            />
            <PrimaryButton label={t('scriptCocreate.confirm')} phLabel="script_cocreate_confirm" onPress={confirm} loading={busy} />
          </CtaBar>
        </View>
      ) : step === 'edit' && script ? (
        <View style={styles.flex}>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <MascotBubble title={t('scriptCocreate.editAsk')} body={t('scriptCocreate.editSub')} />
            <TextInput
              value={edit.text}
              onChangeText={(text) => setEdit((was) => ({ ...was, text }))}
              placeholder={t('scriptCocreate.editPlaceholder')}
              placeholderTextColor={palette.textFaint}
              maxLength={FREE_TEXT_MAX.revision}
              multiline
              style={styles.input}
              accessibilityLabel={t('scriptCocreate.editAsk')}
            />
            <CastAndLength
              characterCount={edit.characterCount}
              minutes={edit.minutes}
              onCount={(n) => setEdit((was) => ({ ...was, characterCount: n }))}
              onMinutes={(n) => setEdit((was) => ({ ...was, minutes: n }))}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </ScrollView>
          <CtaBar divider>
            <PrimaryButton
              label={t('scriptCocreate.applyEdit')}
              phLabel="script_cocreate_apply_edit"
              onPress={applyEdit}
              loading={busy}
              disabled={!revisionChanged(script, edit)}
            />
          </CtaBar>
        </View>
      ) : step === 'failed' ? (
        <View style={styles.flex}>
          <View style={styles.center}>
            <Text style={styles.waitTitle}>{t('scriptCocreate.failTitle')}</Text>
            <Text style={styles.waitSub}>{t('scriptCocreate.failSub')}</Text>
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>
          <CtaBar>
            <PrimaryButton label={t('scriptCocreate.failRetry')} phLabel="script_cocreate_fail_retry" onPress={() => void generate()} />
            <SecondaryButton label={t('scriptCocreate.failOwn')} phLabel="script_cocreate_fail_own" onPress={() => router.replace('/reading/new')} />
          </CtaBar>
        </View>
      ) : step === 'start' ? (
        <View style={styles.flex}>
          <ScrollView contentContainerStyle={styles.body}>
            <MascotBubble title={t('scriptCocreate.startAsk')} guide={t('scriptCocreate.pickNext')} />
            {(['sample', 'make'] as const).map((key) => (
              <Pressable
                key={key}
                accessibilityRole="radio"
                accessibilityState={{ selected: startChoice === key }}
                ph-label={`script_cocreate_start_${key}`}
                onPress={() => setStartChoice(key)}
                style={[styles.choice, startChoice === key && styles.choiceOn]}>
                <Text style={styles.choiceTitle}>{t(key === 'sample' ? 'scriptCocreate.startSample' : 'scriptCocreate.startMake')}</Text>
                <Text style={styles.choiceSub}>{t(key === 'sample' ? 'scriptCocreate.startSampleSub' : 'scriptCocreate.startMakeSub')}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <CtaBar divider>
            <PrimaryButton
              label={t('scriptCocreate.next')}
              phLabel="script_cocreate_start_next"
              disabled={!startChoice}
              onPress={() => (startChoice === 'sample' ? router.replace('/reading/sample') : setStep('emotion'))}
            />
          </CtaBar>
        </View>
      ) : step === 'saved' && script ? (
        <View style={styles.flex}>
          {/* 저장한 대본을 그대로 보여 준다 — 찍기 전에 대사를 다시 볼 수 있어야 하고, 어디에 저장됐는지도 알려 준다. */}
          <ScrollView contentContainerStyle={styles.resultBody}>
            <MascotBubble title={t('scriptCocreate.savedTitle')} body={t('scriptCocreate.savedSub')} />
            <ScriptPaper script={script} />
            <TextButton label={t('scriptCocreate.openInReading')} phLabel="script_cocreate_open_reading" onPress={() => void openInReading()} disabled={busy} />
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </ScrollView>
          <CtaBar>
            <PrimaryButton label={t('scriptCocreate.recordNow')} phLabel="script_cocreate_record_now" onPress={recordNow} />
            <SecondaryButton label={t('scriptCocreate.later')} phLabel="script_cocreate_later" onPress={() => router.back()} />
          </CtaBar>
        </View>
      ) : (
        <View style={styles.flex}>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {step === 'emotion' ? (
              <>
                <MascotBubble title={t('scriptCocreate.emotionAsk')} guide={t('scriptCocreate.pickNext')} />
                <View style={styles.chips}>
                  {[...EMOTIONS, ANY_EMOTION].map((label) => (
                    <Chip
                      key={label}
                      label={label}
                      role="radio"
                      selected={emotion === label}
                      phLabel="script_cocreate_emotion"
                      onPress={() => {
                        setEmotion(label);
                        setStep('situation');
                      }}
                    />
                  ))}
                </View>
              </>
            ) : step === 'situation' ? (
              <>
                <MascotBubble title={t('scriptCocreate.situationAsk')} guide={t('scriptCocreate.pickNext')} />
                <View style={styles.chips}>
                  {[...SITUATIONS, ANY_SITUATION].map((label) => (
                    <Chip
                      key={label}
                      label={label}
                      role="radio"
                      selected={situation === label}
                      phLabel="script_cocreate_situation"
                      onPress={() => setSituation(label)}
                    />
                  ))}
                </View>
                <TextInput
                  value={situation}
                  onChangeText={setSituation}
                  placeholder={t('scriptCocreate.situationPlaceholder')}
                  placeholderTextColor={palette.textFaint}
                  maxLength={FREE_TEXT_MAX.situation}
                  style={styles.input}
                  accessibilityLabel={t('scriptCocreate.situationAsk')}
                />
              </>
            ) : (
              <>
                <MascotBubble title={t('scriptCocreate.directionAsk')} guide={t('scriptCocreate.directionSub')} />
                <TextInput
                  value={direction}
                  onChangeText={setDirection}
                  placeholder={t('scriptCocreate.directionPlaceholder')}
                  placeholderTextColor={palette.textFaint}
                  maxLength={FREE_TEXT_MAX.direction}
                  multiline
                  style={styles.input}
                  accessibilityLabel={t('scriptCocreate.directionAsk')}
                />
                <CastAndLength characterCount={characterCount} minutes={minutes} onCount={setCharacterCount} onMinutes={setMinutes} />
                {error ? <Text style={styles.error}>{error}</Text> : null}
              </>
            )}
          </ScrollView>
          {step === 'situation' ? (
            <CtaBar divider>
              <PrimaryButton
                label={t('scriptCocreate.next')}
                phLabel="script_cocreate_situation_next"
                onPress={() => setStep('direction')}
                disabled={!situation.trim()}
              />
            </CtaBar>
          ) : step === 'direction' ? (
            <CtaBar divider>
              <PrimaryButton label={t('scriptCocreate.generate')} phLabel="script_cocreate_generate" onPress={generate} />
            </CtaBar>
          ) : null}
        </View>
      )}
    </SafeAreaView>
  );
}

/** 배역 수(혼자 독백 / 2인 대화)와 분량(약 1분 / 약 3분). 고르기만으로는 서버를 부르지 않는다. */
function CastAndLength({
  characterCount,
  minutes,
  onCount,
  onMinutes,
}: {
  characterCount: number;
  minutes: number;
  onCount: (n: number) => void;
  onMinutes: (n: number) => void;
}) {
  return (
    <>
      <Text style={styles.label}>{t('scriptCocreate.castLabel')}</Text>
      <View style={styles.chips}>
        {CAST_OPTIONS.map((n) => (
          <Chip
            key={n}
            label={n === 1 ? t('scriptCocreate.castSolo') : t('scriptCocreate.castPair')}
            role="radio"
            selected={characterCount === n}
            phLabel="script_cocreate_cast"
            onPress={() => onCount(n)}
          />
        ))}
      </View>
      <Text style={styles.label}>{t('scriptCocreate.lengthLabel')}</Text>
      <View style={styles.chips}>
        {LENGTH_OPTIONS.map((n) => (
          <Chip
            key={n}
            label={t('scriptCocreate.lengthMinutes', { count: n })}
            role="radio"
            selected={minutes === n}
            phLabel="script_cocreate_length"
            onPress={() => onMinutes(n)}
          />
        ))}
      </View>
      <Text style={styles.hint}>{t('scriptCocreate.lengthHint')}</Text>
    </>
  );
}

/** 만든 대본 한 장 — 제목·요약·메모와 줄(장면·지문·대사). 결과 화면과 저장 화면이 같이 쓴다. */
function ScriptPaper({ script }: { script: SampleScript }) {
  return (
    <>
      <Text style={styles.scriptTitle}>{script.title}</Text>
      <Text style={styles.summary}>{summaryLine(script)}</Text>
      {script.note ? <Text style={styles.note}>{script.note}</Text> : null}
      <View style={styles.paper}>
        {script.lines.map((line, i) =>
          line.kind === 'dialogue' ? (
            <View key={i} style={styles.lineRow}>
              <Text style={styles.speaker}>{line.character}</Text>
              <Text style={styles.dialogue}>{line.text}</Text>
            </View>
          ) : (
            <Text key={i} style={line.kind === 'scene' ? styles.sceneLine : styles.direction}>
              {line.kind === 'scene' ? line.text : `(${line.text})`}
            </Text>
          ),
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  flex: { flex: 1, minWidth: 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 32 },
  waitTitle: { marginTop: 6, fontSize: 17, fontWeight: '700', color: palette.text },
  waitSub: { fontSize: 14, fontWeight: '500', color: palette.textMuted, textAlign: 'center' },
  body: { paddingTop: 15, paddingHorizontal: 20, paddingBottom: 24, gap: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  input: {
    minHeight: 48,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: palette.bgSoft,
    fontSize: 15,
    lineHeight: 21,
    color: palette.text,
  },
  label: { marginTop: 6, fontSize: 13, fontWeight: '700', color: palette.textMuted },
  hint: { fontSize: 12.5, fontWeight: '500', color: palette.textFaint },
  error: { fontSize: 14, fontWeight: '600', color: palette.danger },
  // 결과(pen 「대본 같이 만들기 · 결과」) — 제목 20/800, 요약 13/600, 대본은 넓게 대사 15.
  resultBody: { paddingTop: 12, paddingHorizontal: 20, paddingBottom: 20, gap: 8 },
  scriptTitle: { fontSize: 20, fontWeight: '800', color: palette.text },
  summary: { fontSize: 13, fontWeight: '600', color: palette.textMuted },
  note: { fontSize: 13.5, fontWeight: '600', color: palette.blueDeep },
  paper: { marginTop: 8, gap: 10, padding: 18, borderRadius: 18, backgroundColor: palette.bgSoft },
  lineRow: { gap: 2 },
  speaker: { fontSize: 12.5, fontWeight: '700', color: palette.textMuted },
  dialogue: { fontSize: 15, lineHeight: 23, color: palette.text },
  sceneLine: { fontSize: 13, fontWeight: '700', color: palette.textMuted },
  direction: { fontSize: 14, lineHeight: 20, color: palette.textFaint },
  choice: { gap: 4, padding: 18, borderRadius: 16, backgroundColor: palette.bg, borderWidth: 1, borderColor: palette.border },
  choiceOn: { backgroundColor: palette.bgSoft, borderColor: palette.blue },
  choiceTitle: { fontSize: 16, fontWeight: '700', color: palette.text },
  choiceSub: { fontSize: 13.5, fontWeight: '500', color: palette.textMuted },
  left: { fontSize: 12.5, fontWeight: '600', color: palette.textFaint, textAlign: 'center' },
});
