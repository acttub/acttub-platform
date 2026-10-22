import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { Stack } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, BackHandler, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton, TextButton } from '@/components/ui/buttons';
import { Chip } from '@/components/ui/chip';
import { CtaBar } from '@/components/ui/cta-bar';
import { MASCOT, MASCOT_SIZE } from '@/components/ui/mascot';
import { MascotBubble } from '@/components/ui/mascot-bubble';
import { StatusScreen } from '@/components/ui/status-screen';
import { ProgressHeader } from '@/components/ui/step-header';
import { SummaryEditCard, SummaryRow } from '@/components/ui/summary-row';
import { motion } from '@/constants/motion';
import { palette } from '@/constants/palette';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  DISCOVERY_OTHER_MAX_LENGTH,
  EMPTY_DISCOVERY,
  buildDiscoveryPayload,
  chooseDiscoverySource,
  discoveryOrder,
  limitOtherText,
  shouldAskDiscovery,
  type DiscoveryState,
} from '@/lib/discovery';
import { translate as t, translateList } from '@/lib/i18n';
import { logMetaEvent } from '@/lib/meta-events';
import {
  birthStepOutcome,
  nextOpenStep,
  onboardingSteps,
  stepBefore,
  stepReady,
  type OnboardingStep,
} from '@/lib/onboarding-steps';
import { takeProviderNameHint } from '@/lib/profile';
import { DIRECTION_LABEL_KEYS, GENDER_LABEL_KEYS } from '@/lib/profile-labels';
import {
  DIRECTION_VALUES,
  EXPERIENCE_VALUES,
  GOAL_VALUES,
  NAME_MAX_LENGTH,
  buildProfilePayload,
  checkBirthDate,
  formatBirthDateInput,
  initialProfileForm,
  profileSaveFailure,
  type Gender,
  type ProfileFormState,
} from '@/lib/profile-form';
import { readAttributedChannel, recordSignupCompleted } from '@/lib/signup-attribution-runtime';


type Screen = 'intro' | OnboardingStep | 'blocked';
/** pen ①-3 순서 — 남성 · 여성 · 선택 안 함. 값은 서버 그대로(GENDER_VALUES). */
const GENDER_ORDER: readonly Gender[] = ['male', 'female', 'unspecified'];

/**
 * A0.2 가입 게이트 — pen 온보딩(시작 → ①-1 닉네임 … ⑧ 어디서 알게 됐나요, SOMA-748). 게이트가 프로필이 빈 회원에게만 띄운다.
 *
 * 서버가 받는 여섯 항목(이름·생년월일·성별·최종 목표·연기 경력·추구하는 방향)을 하나씩 묻고 끝에서 한 번
 * 저장한다(PUT /v2/me/profile, 부분 저장 없음 — 도중에 앱을 닫으면 처음부터).
 *
 * 토스 가입처럼(SOMA-790) 「계속하기」 없이 답하면 다음 질문이 맨 위에 나오고, 캐릭터 말풍선이 그 질문으로 바뀐다.
 * 답한 칸은 아래에 최근 것부터 쌓이고 누르면 그 질문으로 돌아가 고친다. 생년월일은 8자리가 차면, 하나 고르는 질문은
 * 누르면 넘어간다. 언제 다 적었는지 알 수 없는 닉네임과 여러 개 고르는 추구하는 방향만 버튼으로 마친다. 어디서 알게 됐나(SOMA-649)는 Airbridge 가
 * 출처를 모를 때만 맨 끝에 묻는다(SOMA-733). 만 14세 미만 생년월일은 「가입할 수 없어요」로 보낸다.
 *
 * 모양은 pen 01 가입(파이프라인 반영버전): 고르는 질문은 말풍선 아래 회색 「○○ 선택」 제목(13/600)과 답 칩(높이 42),
 * 답한 칸은 요약 행. 지난 답변을 눌러 돌아간 질문은 그 요약 행 자리의 파란 테두리 칸(SummaryEditCard)에서 고르고, 위에
 * 「지난 답변을 누르면 바로 고칠 수 있어요」를 둔다(추구하는 방향은 「여러 개 고를 수 있어요」를 덧붙인다).
 * pen 의 「요즘 연습 방식」「이루고 싶은 것」·출생연도만 받기·연기 목표/경력 값 바꾸기는 서버 변경이 필요해 넣지 않았다.
 */
export default function ProfileNameScreen() {
  const { profile, reloadProfile, saveProfile, closeAccountUnder14, signOut } = useAuth();
  const [form, setForm] = useState<ProfileFormState>(() => initialProfileForm(null, null));
  const [screen, setScreen] = useState<Screen>('intro');
  // 답을 마친 질문. 아래에 쌓아 보이고, 다음 질문을 고를 때 건너뛴다.
  const [done, setDone] = useState<ReadonlySet<OnboardingStep>>(() => new Set());
  const reduceMotion = useReducedMotion();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [birthInvalid, setBirthInvalid] = useState(false);
  const keyboardHeight = useKeyboardHeight();
  const [discovery, setDiscovery] = useState<DiscoveryState>(EMPTY_DISCOVERY);
  const discoverySources = useMemo(() => discoveryOrder(), []);
  // Airbridge 가 이미 광고·추적 링크로 출처를 확인한 설치면 묻지 않는다(SOMA-733). 귀속을 읽기 전에는 묻는 쪽으로 둔다.
  const [askDiscovery, setAskDiscovery] = useState(true);
  const steps = onboardingSteps(askDiscovery);
  const prefilled = useRef(false);
  const me = profile.me;

  useEffect(() => {
    let alive = true;
    void readAttributedChannel()
      .then((channel) => {
        if (alive) setAskDiscovery(shouldAskDiscovery(channel));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // 서버에서 받은 값으로 한 번만 채운다. 0.1.0 이전 회원은 옛 닉네임이 이름 칸에 채워져 오고,
  // 이름이 없으면 로그인 제공자가 준 이름을 첫 값으로 쓴다(저장은 끝에서).
  useEffect(() => {
    if (prefilled.current || !me) return;
    prefilled.current = true;
    setForm(initialProfileForm(me.profile, takeProviderNameHint()));
  }, [me]);

  const goBack = (): boolean => {
    if (busy) return true;
    if (screen === 'intro') return false;
    setError(null);
    if (screen === 'blocked') setScreen('birth');
    else setScreen(stepBefore(steps, screen));
    return true;
  };

  // 안드로이드 뒤로 키도 앞 단계로 간다. 시작 화면에서는 OS 기본 동작에 맡긴다.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', goBack);
    return () => sub.remove();
  });

  const update = (patch: Partial<ProfileFormState>) => setForm((prev) => ({ ...prev, ...patch }));

  const submit = async (answer: DiscoveryState = discovery) => {
    setBusy(true);
    setError(null);
    try {
      const now = new Date();
      await saveProfile(buildProfilePayload(form, now));
      void logEvent('profile_setup', {
        mediums: form.directions.join(',') || 'none',
        career: form.experience ?? 'none',
        goal: form.goal ?? 'none',
      });
      logMetaEvent('fb_mobile_complete_registration');
      // 이 기기에서 가입을 마친 계정에만 유입 광고를 붙인다(SOMA-588).
      if (me?.id) recordSignupCompleted(me.id);
      // 처음 어디서 알게 됐는지(SOMA-649). 고르지 않았으면 건너뜀으로 적는다. 저장은 끝났으므로 기다리지 않고,
      // 실패해도 가입 흐름을 막지 않는다(서버는 처음 답만 남긴다). 묻지 않은 사람은 보내지 않는다(SOMA-733).
      if (askDiscovery) void api.recordDiscoveryAnswer(buildDiscoveryPayload(answer)).catch(() => {});
      // 저장이 곧 게이트 통과라 _layout 이 화면을 옮긴다.
    } catch (cause) {
      const failure = profileSaveFailure(cause);
      if (failure.kind === 'account_closed') {
        // 만 14세 미만. 서버가 계정을 닫았다 — 안내를 남기고 로그인으로 간다.
        await closeAccountUnder14();
        return;
      }
      // 칸에서 이미 막으므로 여기 오는 것은 기기 날짜가 어긋난 경우 같은 안전망이다.
      if (failure.kind === 'under_14') setScreen('blocked');
      else if (failure.kind === 'client_bug') setError(t('profileName.appBug'));
      else setError(cause instanceof Error ? cause.message : t('profileName.fail'));
    } finally {
      setBusy(false);
    }
  };

  /** 이 질문을 마치고 아직 안 답한 다음 질문으로. 다 답했으면 저장한다. */
  const advance = (from: OnboardingStep, patch?: Partial<ProfileFormState>, answer?: DiscoveryState) => {
    const nextForm = patch ? { ...form, ...patch } : form;
    if (patch) update(patch);
    setError(null);
    if (from === 'birth') {
      const outcome = birthStepOutcome(nextForm.birthDate, new Date());
      if (outcome === 'invalid') {
        setBirthInvalid(true);
        return;
      }
      if (outcome === 'blocked') {
        setScreen('blocked');
        return;
      }
    }
    const answered = new Set(done).add(from);
    setDone(answered);
    const next = nextOpenStep(steps, answered, from);
    if (next) setScreen(next);
    else void submit(answer);
  };

  /** 생년월일은 8자리가 차면 바로 넘어간다. 있을 수 없는 날짜는 칸 아래에 이유를 보이고 멈춘다. */
  const changeBirth = (text: string) => {
    const birthDate = formatBirthDateInput(text);
    setBirthInvalid(false);
    update({ birthDate });
    if (birthDate.replace(/\D/g, '').length === 8) advance('birth', { birthDate });
  };

  if (!me) {
    // 내 계정을 아직 못 읽었다. 읽기 전에 빈 폼을 보여 주면 옛 닉네임을 덮어쓰게 된다.
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.center}>
          {profile.status === 'error' ? (
            <>
              <Text style={styles.loadError}>{t('profileName.loadFail')}</Text>
              {/* pen S5.2 — 빨간 한 줄 아래 파란 글자 링크. */}
              <TextButton tone="accent" label={t('profileName.reload')} onPress={() => void reloadProfile()} />
            </>
          ) : (
            <ActivityIndicator color={palette.blue} />
          )}
        </View>
      </SafeAreaView>
    );
  }

  // 시작 화면 — 코치 캐릭터 인사(pen mmutfq).
  if (screen === 'intro') {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.introCenter}>
          <Image source={MASCOT.home} style={MASCOT_SIZE.intro} contentFit="contain" accessibilityIgnoresInvertColors />
          <Text style={styles.introTitle}>{t('profileName.introTitle')}</Text>
          <Text style={styles.introBody}>{t('profileName.introBody', { count: steps.length })}</Text>
          <View style={styles.introBadge}>
            <Feather name="clock" size={17} color={palette.blueDeep} />
            <Text style={styles.introBadgeText}>{t('profileName.introBadge')}</Text>
          </View>
        </View>
        <CtaBar safeBottom={false} style={styles.footer}>
          <PrimaryButton label={t('profileName.introCta')} onPress={() => setScreen(steps[0])} />
        </CtaBar>
      </SafeAreaView>
    );
  }

  // 가입할 수 없어요(pen uU9cWO) — 동의의 「[필수] 만 14세 이상」과 같은 기준. 확인을 누르면 로그아웃해 로그인으로 간다.
  if (screen === 'blocked') {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <Stack.Screen options={{ headerShown: false }} />
        <StatusScreen
          size="large"
          onBack={goBack}
          mascot={MASCOT.coach}
          title={t('profileName.blockedTitle')}
          body={t('profileName.blockedBody')}
          primary={{ label: t('common.confirm'), onPress: () => void signOut() }}
        />
      </SafeAreaView>
    );
  }

  const step = screen;
  const index = steps.indexOf(step) + 1;
  const name = form.name.trim();
  const ready = stepReady(step, form, new Date());
  const careers = translateList('profileName.careerOptions');
  const goals = translateList('profileName.goalOptions');
  const nameTooLong = [...name].length > NAME_MAX_LENGTH;
  const birthCheck = checkBirthDate(form.birthDate, new Date());

  let body: ReactNode = null;
  let footer: ReactNode = null;
  /** 칸을 다 적었는지 알 수 없는 질문(닉네임·추구하는 방향·기타 직접 적기)만 버튼으로 마친다. 마지막이면 「완료」. */
  const finishButton = (onPress: () => void, enabled: boolean) => (
    <PrimaryButton
      label={nextOpenStep(steps, done, step) ? t('profileName.next') : t('profileName.done')}
      onPress={onPress}
      disabled={!enabled}
      loading={busy}
    />
  );

  // 지난 답변을 눌러 돌아온 질문 — 답한 칸 자리의 파란 테두리 칸에서 고친다(pen 7/7 · 지난 답변 수정).
  const editing = done.has(step);
  const isChoice = step !== 'name' && step !== 'birth';
  /** 고르는 질문의 몸 — 처음엔 회색 「○○ 선택」 제목 아래 칩, 고치는 중이면 칩만(제목은 수정 칸 머리가 맡는다). */
  const choiceBlock = (chips: ReactNode) =>
    editing ? (
      chips
    ) : (
      <>
        <Text style={styles.pickLabel}>{t(PICK_LABEL_KEYS[step])}</Text>
        <View style={styles.pickOptions}>{chips}</View>
      </>
    );

  switch (step) {
    case 'name':
      body = (
        <>
          <TextInput
            style={styles.input}
            placeholder={t('profileName.placeholder')}
            placeholderTextColor={palette.checkOff}
            value={form.name}
            onChangeText={(value) => update({ name: value })}
            autoFocus
            returnKeyType="next"
            onSubmitEditing={() => ready && advance('name')}
            accessibilityLabel={t('profileName.nicknameLabel')}
          />
          {nameTooLong && <Text style={styles.fieldError}>{t('profileName.nameTooLong')}</Text>}
        </>
      );
      footer = finishButton(() => advance('name'), ready);
      break;
    case 'birth':
      body = (
        <>
          <TextInput
            style={styles.input}
            placeholder={t('profileName.birthPlaceholder')}
            placeholderTextColor={palette.checkOff}
            value={form.birthDate}
            onChangeText={changeBirth}
            keyboardType="number-pad"
            maxLength={10}
            autoFocus
            accessibilityLabel={t('profileName.birthLabel')}
          />
          {(birthInvalid || birthCheck.kind === 'invalid') && (
            <Text style={styles.fieldError}>{t('profileName.birthInvalid')}</Text>
          )}
        </>
      );
      break;
    case 'gender':
      // 「선택 안 함」이 있어 건너뛰기는 두지 않는다 — 서버 값 그대로(unspecified).
      body = choiceBlock(
        <View style={styles.chipRow}>
          {GENDER_ORDER.map((gender) => (
            <Chip
              key={gender}
              variant="answer"
              role="radio"
              label={t(GENDER_LABEL_KEYS[gender])}
              selected={form.gender === gender}
              onPress={() => advance('gender', { gender })}
            />
          ))}
        </View>,
      );
      break;
    case 'goal':
      body = choiceBlock(
        <View style={styles.chipRow}>
          {GOAL_VALUES.map((goal, i) => (
            <Chip
              key={goal}
              variant="answer"
              role="radio"
              label={goals[i] ?? goal}
              selected={form.goal === goal}
              onPress={() => advance('goal', { goal })}
            />
          ))}
        </View>,
      );
      break;
    case 'career':
      // 세 개씩 두 줄, 칸은 줄 폭을 나눠 갖는다(pen 5/7).
      body = choiceBlock(
        <View style={styles.chipRows}>
          {[EXPERIENCE_VALUES.slice(0, 3), EXPERIENCE_VALUES.slice(3)].map((line, row) => (
            <View key={row} style={styles.chipRow}>
              {line.map((experience) => (
                <Chip
                  key={experience}
                  variant="answer"
                  role="radio"
                  style={styles.chipFill}
                  label={careers[EXPERIENCE_VALUES.indexOf(experience)] ?? experience}
                  selected={form.experience === experience}
                  onPress={() => advance('career', { experience })}
                />
              ))}
            </View>
          ))}
        </View>,
      );
      break;
    case 'directions':
      body = choiceBlock(
        <View style={styles.chipRow}>
          {DIRECTION_VALUES.map((direction) => (
            <Chip
              key={direction}
              variant="answer"
              role="checkbox"
              style={styles.chipFill}
              label={t(DIRECTION_LABEL_KEYS[direction])}
              selected={form.directions.includes(direction)}
              onPress={() =>
                update({
                  directions: form.directions.includes(direction)
                    ? form.directions.filter((d) => d !== direction)
                    : [...form.directions, direction],
                })
              }
            />
          ))}
        </View>,
      );
      footer = finishButton(() => advance('directions'), ready);
      break;
    case 'discovery':
      // 하나 누르면 바로 저장한다. 「기타」만 직접 적고 「완료」를 누른다. 건너뛰면 고르지 않은 것으로 적는다.
      body = choiceBlock(
        <>
          <View style={[styles.chipRow, styles.chipWrap]}>
            {discoverySources.map((source) => (
              <Chip
                key={source}
                variant="answer"
                compact
                role="radio"
                label={t(`profileName.discoverySources.${source}`)}
                selected={discovery.source === source}
                onPress={() => {
                  const answer = chooseDiscoverySource(discovery, source);
                  setDiscovery(answer);
                  if (source !== 'other' && answer.source === source) advance('discovery', undefined, answer);
                }}
              />
            ))}
          </View>
          {discovery.source === 'other' && (
            <TextInput
              style={[styles.input, styles.otherInput]}
              placeholder={t('profileName.discoveryOtherPlaceholder')}
              placeholderTextColor={palette.checkOff}
              value={discovery.otherText}
              onChangeText={(text) => setDiscovery((prev) => ({ ...prev, otherText: limitOtherText(text) }))}
              maxLength={DISCOVERY_OTHER_MAX_LENGTH * 2}
              autoFocus
            />
          )}
        </>,
      );
      footer = (
        <>
          {discovery.source === 'other' &&
            finishButton(() => advance('discovery'), discovery.otherText.trim().length > 0)}
          <TextButton
            size="large"
            label={t('profileName.skip')}
            onPress={() => {
              setDiscovery(EMPTY_DISCOVERY);
              advance('discovery', undefined, EMPTY_DISCOVERY);
            }}
            disabled={busy}
          />
        </>
      );
      break;
  }

  // 답한 칸 — 최근 것부터 아래로 쌓는다. 누르면 그 질문으로 돌아가 고친다.
  const answeredRows = steps
    .filter((s) => s !== step && s !== 'discovery' && done.has(s))
    .reverse()
    .map((s) => ({ step: s, label: t(SUMMARY_LABEL_KEYS[s]), value: summaryValue(s) }));

  function summaryValue(s: OnboardingStep): string {
    switch (s) {
      case 'name':
        return name;
      case 'birth':
        return form.birthDate;
      case 'gender':
        return form.gender ? t(GENDER_LABEL_KEYS[form.gender]) : '';
      case 'goal':
        return form.goal ? (goals[GOAL_VALUES.indexOf(form.goal)] ?? form.goal) : '';
      case 'career':
        return form.experience ? (careers[EXPERIENCE_VALUES.indexOf(form.experience)] ?? form.experience) : '';
      case 'directions':
        return DIRECTION_VALUES.filter((d) => form.directions.includes(d))
          .map((d) => t(DIRECTION_LABEL_KEYS[d]))
          .join(', ');
      default:
        return '';
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={keyboardHeight > 0 ? ['top'] : ['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <ProgressHeader step={index} total={steps.length} onBack={goBack} />
      <View style={[styles.flex, { paddingBottom: keyboardHeight }]}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <MascotBubble title={t(ASK_KEYS[step], { name })} guide={t(ASK_HINT_KEYS[step])} />
          {editing && isChoice ? null : (
            <Animated.View
              key={step}
              entering={reduceMotion ? undefined : FadeInDown.duration(motion.standard)}
              style={isChoice ? styles.currentChoice : styles.currentInput}>
              {body}
            </Animated.View>
          )}
          {error && <Text style={styles.error}>{error}</Text>}
          {(answeredRows.length > 0 || (editing && isChoice)) && (
            <View style={isChoice ? styles.answeredAfterChoice : styles.answeredAfterInput}>
              {editing && <Text style={styles.editHint}>{t('profileName.editHint')}</Text>}
              <View style={styles.answeredList}>
                {editing && isChoice && (
                  <Animated.View key={step} entering={reduceMotion ? undefined : FadeInDown.duration(motion.standard)}>
                    <SummaryEditCard
                      label={t(SUMMARY_LABEL_KEYS[step])}
                      hint={step === 'directions' ? t('profileName.editManyHint') : undefined}>
                      {body}
                    </SummaryEditCard>
                  </Animated.View>
                )}
                {answeredRows.map((row) => (
                  <SummaryRow
                    key={row.step}
                    label={row.label}
                    value={row.value}
                    onPress={() => {
                      setError(null);
                      setScreen(row.step);
                    }}
                  />
                ))}
              </View>
            </View>
          )}
        </ScrollView>
        {footer && (
          <CtaBar safeBottom={false} style={styles.footer}>
            {footer}
          </CtaBar>
        )}
      </View>
    </SafeAreaView>
  );
}

/** 질문마다 캐릭터 말풍선 제목·안내. */
const ASK_KEYS: Record<OnboardingStep, string> = {
  name: 'profileName.askName',
  birth: 'profileName.askBirth',
  gender: 'profileName.askGender',
  goal: 'profileName.askGoal',
  career: 'profileName.askCareer',
  directions: 'profileName.askDirections',
  discovery: 'profileName.askDiscovery',
};
const ASK_HINT_KEYS: Record<OnboardingStep, string> = {
  name: 'profileName.askNameHint',
  birth: 'profileName.askBirthHint',
  gender: 'profileName.askGenderHint',
  goal: 'profileName.askGoalHint',
  career: 'profileName.askCareerHint',
  directions: 'profileName.askDirectionsHint',
  discovery: 'profileName.askDiscoveryHint',
};
/** 고르는 질문의 회색 제목(pen 01 「○○ 라벨」). */
const PICK_LABEL_KEYS: Record<OnboardingStep, string> = {
  name: 'profileName.nicknameLabel',
  birth: 'profileName.birthLabel',
  gender: 'profileName.pickGender',
  goal: 'profileName.pickGoal',
  career: 'profileName.pickCareer',
  directions: 'profileName.pickDirections',
  discovery: 'profileName.pickDiscovery',
};
/** 답한 칸의 이름. */
const SUMMARY_LABEL_KEYS: Record<OnboardingStep, string> = {
  name: 'profileName.nicknameLabel',
  birth: 'profileName.birthLabel',
  gender: 'profileName.genderLabel',
  goal: 'profileName.rowGoal',
  career: 'profileName.careerLabel',
  directions: 'profileName.rowDirections',
  discovery: 'profileName.discoveryLabel',
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },

  // pen 01 가입 시작 — 위에서 168(상태 막대 35 포함) 아래에 액티 127×142, 16 · 제목 26/800 · 8 · 설명 16/400 · 13 · 「1분이면 끝나요」.
  introCenter: { flex: 1, alignItems: 'center', paddingTop: 133, paddingHorizontal: 24 },
  introTitle: { marginTop: 16, fontSize: 26, fontWeight: '800', lineHeight: 36, color: palette.text, textAlign: 'center' },
  introBody: {
    marginTop: 8,
    maxWidth: 290,
    fontSize: 16,
    fontWeight: '400',
    lineHeight: 24,
    color: palette.textDim,
    textAlign: 'center',
  },
  introBadge: {
    marginTop: 13,
    height: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: palette.blueSoft,
    borderRadius: 17,
    paddingHorizontal: 16,
  },
  introBadgeText: { fontSize: 16, fontWeight: '700', color: palette.blueDeep },
  // pen 01 「Footer」 — 안쪽 [0,20,11,20].
  footer: { paddingTop: 8, paddingHorizontal: 20, paddingBottom: 11 },

  // pen 01 질문 「Body」 — 안쪽 [10,20,0,20]. 말풍선 아래 칸까지 23(입력)·18(고르기), 답한 칸까지 28(입력)·24(고르기).
  body: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 24 },
  currentInput: { marginTop: 23 },
  currentChoice: { marginTop: 18 },
  pickLabel: { fontSize: 13, fontWeight: '600', color: palette.textMuted },
  pickOptions: { paddingTop: 8 },
  chipRows: { gap: 8 },
  chipRow: { flexDirection: 'row', gap: 8 },
  chipWrap: { flexWrap: 'wrap' },
  chipFill: { flex: 1, paddingHorizontal: 8 },
  answeredAfterInput: { marginTop: 28 },
  answeredAfterChoice: { marginTop: 24 },
  answeredList: { gap: 9 },
  editHint: { paddingBottom: 8, fontSize: 13, fontWeight: '600', color: palette.textFaint },
  input: {
    height: 51,
    backgroundColor: palette.bgSoft,
    borderRadius: 16,
    paddingHorizontal: 14,
    fontSize: 16,
    fontWeight: '700',
    color: palette.text,
  },
  otherInput: { marginTop: 8 },
  fieldError: { marginTop: 8, fontSize: 13, color: palette.danger },
  error: { marginTop: 12, color: palette.danger, fontSize: 13 },
  loadError: { color: palette.danger, fontSize: 13, textAlign: 'center' },
});
