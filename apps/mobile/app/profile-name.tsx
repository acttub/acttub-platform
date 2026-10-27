import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { Stack } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BirthWheel, formatBirthParts, parseBirthDate, type BirthParts } from '@/components/birth-wheel';
import { PrimaryButton, TextButton } from '@/components/ui/buttons';
import { CtaBar } from '@/components/ui/cta-bar';
import { MASCOT, MASCOT_SIZE } from '@/components/ui/mascot';
import { MascotBubble } from '@/components/ui/mascot-bubble';
import { StatusScreen } from '@/components/ui/status-screen';
import { StepHeader } from '@/components/ui/step-header';
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
  onboardingSteps,
  stepAfter,
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
  initialProfileForm,
  profileSaveFailure,
  type Gender,
  type ProfileFormState,
} from '@/lib/profile-form';
import { readAttributedChannel, recordSignupCompleted } from '@/lib/signup-attribution-runtime';
import { SkeletonDetail } from '@/components/ui/skeleton';


type Screen = 'intro' | OnboardingStep | 'blocked';
/** pen ①-3 순서 — 남성 · 여성 · 선택 안 함. 값은 서버 그대로(GENDER_VALUES). */
const GENDER_ORDER: readonly Gender[] = ['male', 'female', 'unspecified'];

/**
 * A0.2 가입 게이트 — pen 온보딩(시작 → ①-1 닉네임 … ⑧ 어디서 알게 됐나요, SOMA-748). 게이트가 프로필이 빈 회원에게만 띄운다.
 *
 * 서버가 받는 여섯 항목(이름·생년월일·성별·최종 목표·연기 경력·추구하는 방향)을 하나씩 묻고 끝에서 한 번
 * 저장한다(PUT /v2/me/profile, 부분 저장 없음 — 도중에 앱을 닫으면 처음부터).
 *
 * 한 화면에 질문 하나(pen S5.15~S5.24). 위에 진행 막대, 액티 말풍선의 질문, 아래 「다음」 순서다. 고르는 질문은 기본 선택 없이 줄을 누르면
 * 파랗게 선택되고, 「다음」을 눌러야 넘어간다(마지막은 「완료」). 생년월일은 연·월·일 돌림판이다. 추구하는 방향만 여러 개 고른다.
 * 어디서 알게 됐나(SOMA-649)는 Airbridge 가 출처를 모를 때만 맨 끝에 묻고(SOMA-733) 「건너뛰기」가 있다. 만 14세 미만 생년월일은
 * 「가입할 수 없어요」로 보낸다. 저장은 마지막에 한 번이다(부분 저장 없음).
 * pen 의 「요즘 연습 방식」「이루고 싶은 것」·출생연도만 받기·연기 목표/경력 값 바꾸기는 서버 변경이 필요해 넣지 않았다.
 */
export default function ProfileNameScreen() {
  const { profile, reloadProfile, saveProfile, closeAccountUnder14, signOut } = useAuth();
  const [form, setForm] = useState<ProfileFormState>(() => initialProfileForm(null, null));
  const [screen, setScreen] = useState<Screen>('intro');
  const reduceMotion = useReducedMotion();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [birthInvalid, setBirthInvalid] = useState(false);
  const [wheelTouch, setWheelTouch] = useState(false);
  const keyboardHeight = useKeyboardHeight();
  // 생년월일 돌림판 — 연도는 오래된 해부터 올해까지, 처음 값은 스무 살 무렵의 1월 1일이다.
  const birthYears = useMemo(() => {
    const thisYear = new Date().getFullYear();
    return Array.from({ length: 101 }, (_, i) => thisYear - 100 + i);
  }, []);
  const defaultBirth = useMemo<BirthParts>(() => ({ year: new Date().getFullYear() - 20, month: 1, day: 1 }), []);
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

  /** 이 질문을 마치고 다음 질문으로. 마지막이면 저장한다. */
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
    const next = stepAfter(steps, from);
    if (next) setScreen(next);
    else void submit(answer);
  };

  // 생년월일 칸에 들어오면 돌림판의 처음 값을 폼에도 넣어, 돌리지 않고 「다음」을 눌러도 보이는 값이 저장된다.
  useEffect(() => {
    if (screen === 'birth' && !parseBirthDate(form.birthDate)) {
      setForm((prev) => ({ ...prev, birthDate: formatBirthParts(defaultBirth) }));
    }
  }, [screen, form.birthDate, defaultBirth]);

  if (!me) {
    // 내 계정을 아직 못 읽었다. 읽기 전에 빈 폼을 보여 주면 옛 닉네임을 덮어쓰게 된다.
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <Stack.Screen options={{ headerShown: false }} />
        {profile.status === 'error' ? (
        <View style={styles.center}>
            <>
              <Text style={styles.loadError}>{t('profileName.loadFail')}</Text>
              {/* pen S5.2 — 빨간 한 줄 아래 파란 글자 링크. */}
              <TextButton tone="accent" label={t('profileName.reload')} onPress={() => void reloadProfile()} />
            </>
        </View>
        ) : (
          <SkeletonDetail lines={2} />
        )}
      </SafeAreaView>
    );
  }

  // 시작 화면 — 코치 캐릭터 인사(pen mmutfq).
  if (screen === 'intro') {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.introCenter}>
          <Image source={MASCOT.home} style={MASCOT_SIZE.intro} contentFit="contain" cachePolicy="memory-disk" accessibilityIgnoresInvertColors />
          <Text style={styles.introTitle}>{t('profileName.introTitle')}</Text>
          <Text style={styles.introBody}>{t('profileName.introBody', { count: steps.length })}</Text>
          <View style={styles.introBadge}>
            <Feather name="clock" size={17} color={palette.blueDeep} />
            <Text style={styles.introBadgeText}>{t('profileName.introBadge')}</Text>
          </View>
        </View>
        <CtaBar safeBottom={false}>
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
  const birthParts = parseBirthDate(form.birthDate) ?? defaultBirth;
  const isLast = stepAfter(steps, step) === null;

  let body: ReactNode = null;
  let footer: ReactNode = null;
  /** 한 화면에 질문 하나 — 고르거나 적고 아래 「다음」(마지막이면 「완료」)을 눌러야 넘어간다. */
  const nextButton = (onPress: () => void, enabled: boolean) => (
    <PrimaryButton
      label={isLast ? t('profileName.done') : t('profileName.next')}
      onPress={onPress}
      disabled={!enabled}
      loading={busy}
    />
  );

  switch (step) {
    case 'name':
      body = (
        <>
          <TextInput
            style={styles.input}
            placeholder={t('profileName.placeholder')}
            placeholderTextColor={palette.textDisabled}
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
      footer = nextButton(() => advance('name'), ready);
      break;
    case 'birth':
      body = (
        <>
          <BirthWheel
            value={birthParts}
            years={birthYears}
            onTouchActive={setWheelTouch}
            onChange={(parts) => {
              setBirthInvalid(false);
              update({ birthDate: formatBirthParts(parts) });
            }}
          />
          {(birthInvalid || checkBirthDate(form.birthDate, new Date()).kind === 'invalid') && <Text style={styles.fieldError}>{t('profileName.birthInvalid')}</Text>}
        </>
      );
      footer = nextButton(() => advance('birth'), ready);
      break;
    case 'gender':
      // 「선택 안 함」이 있어 건너뛰기는 두지 않는다 — 서버 값 그대로(unspecified).
      body = (
        <View style={styles.options}>
          {GENDER_ORDER.map((gender) => (
            <ChoiceRow
              key={gender}
              label={t(GENDER_LABEL_KEYS[gender])}
              selected={form.gender === gender}
              onPress={() => advance('gender', { gender })}
            />
          ))}
        </View>
      );
      break;
    case 'goal':
      body = (
        <View style={styles.options}>
          {GOAL_VALUES.map((goal, i) => (
            <ChoiceRow
              key={goal}
              label={goals[i] ?? goal}
              selected={form.goal === goal}
              onPress={() => advance('goal', { goal })}
            />
          ))}
        </View>
      );
      break;
    case 'career':
      body = (
        <View style={styles.options}>
          {EXPERIENCE_VALUES.map((experience, i) => (
            <ChoiceRow
              key={experience}
              label={careers[i] ?? experience}
              selected={form.experience === experience}
              onPress={() => advance('career', { experience })}
            />
          ))}
        </View>
      );
      break;
    case 'directions':
      body = (
        <View style={styles.options}>
          {DIRECTION_VALUES.map((direction) => (
            <ChoiceRow
              key={direction}
              multi
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
        </View>
      );
      footer = nextButton(() => advance('directions'), ready);
      break;
    case 'discovery':
      // 마지막 질문이라 고르고 「완료」를 눌러야 저장한다(SOMA-827 후속 — 바로 저장하지 않는다). 「기타」는 직접 적는다. 건너뛰면 고르지 않은 것으로 적는다.
      body = (
        <>
          <View style={styles.options}>
            {discoverySources.map((source) => (
              <ChoiceRow
                key={source}
                label={t(`profileName.discoverySources.${source}`)}
                selected={discovery.source === source}
                onPress={() => setDiscovery(chooseDiscoverySource(discovery, source))}
              />
            ))}
          </View>
          {discovery.source === 'other' && (
            <TextInput
              style={[styles.input, styles.otherInput]}
              placeholder={t('profileName.discoveryOtherPlaceholder')}
              placeholderTextColor={palette.textDisabled}
              value={discovery.otherText}
              onChangeText={(text) => setDiscovery((prev) => ({ ...prev, otherText: limitOtherText(text) }))}
              maxLength={DISCOVERY_OTHER_MAX_LENGTH * 2}
              autoFocus
            />
          )}
        </>
      );
      footer = (
        <>
          <TextButton
            size="large"
            label={t('profileName.skip')}
            onPress={() => {
              setDiscovery(EMPTY_DISCOVERY);
              advance('discovery', undefined, EMPTY_DISCOVERY);
            }}
            disabled={busy}
          />
          {nextButton(
            () => advance('discovery'),
            discovery.source !== null && (discovery.source !== 'other' || discovery.otherText.trim().length > 0),
          )}
        </>
      );
      break;
  }

  return (
    <SafeAreaView style={styles.safe} edges={keyboardHeight > 0 ? ['top'] : ['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <StepHeader step={index} total={steps.length} onBack={goBack} />
      <View style={[styles.flex, { paddingBottom: keyboardHeight }]}>
        {/* 생년월일 휠을 만지는 동안은 화면이 같이 움직이지 않게 멈춘다(10/25). */}
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" scrollEnabled={!wheelTouch}>
          {/* 하나 고르는 질문은 누르면 바로 넘어간다(SOMA-827) — 그 사실을 말풍선 아래 줄로 알린다. */}
          <MascotBubble title={t(ASK_KEYS[step], { name })} guide={TAP_TO_NEXT[step] ? t(TAP_TO_NEXT[step]) : null} />
          <Animated.View
            key={step}
            entering={reduceMotion ? undefined : FadeInDown.duration(motion.standard)}
            style={styles.current}>
            {body}
          </Animated.View>
          {error && <Text style={styles.error}>{error}</Text>}
        </ScrollView>
        {footer && (
          <CtaBar safeBottom={false}>
            {footer}
          </CtaBar>
        )}
      </View>
    </SafeAreaView>
  );
}

/**
 * 고르는 줄(pen S5.20~S5.24) — 높이 56, 흰 바탕 · 1px 테두리, 모서리 16. 고르면 옅은 파랑 바탕 · 파란 테두리 · 파란 글자와 오른쪽 체크.
 * 하나만 고르는 질문은 radio, 여럿 고르는 질문(추구하는 방향)은 checkbox 로 읽힌다.
 */
function ChoiceRow({
  label,
  selected,
  onPress,
  multi = false,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  multi?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.choice, selected && styles.choiceOn, pressed && styles.choicePressed]}
      accessibilityRole={multi ? 'checkbox' : 'radio'}
      accessibilityState={multi ? { checked: selected } : { selected }}
      accessibilityLabel={label}>
      <Text style={[styles.choiceText, selected && styles.choiceTextOn]}>{label}</Text>
      {selected && <Feather name="check" size={20} color={palette.blue} />}
    </Pressable>
  );
}

/** 질문마다 캐릭터 말풍선 제목. */
/** 누르면 바로 넘어가는 질문의 안내 줄. 닉네임·생년월일·추구 방향(여러 개)은 「다음」으로 간다. */
const TAP_TO_NEXT: Partial<Record<OnboardingStep, string>> = {
  gender: 'profileName.askGenderHint',
  goal: 'profileName.askGenderHint',
  career: 'profileName.askGenderHint',
};

const ASK_KEYS: Record<OnboardingStep, string> = {
  name: 'profileName.askName',
  birth: 'profileName.askBirth',
  gender: 'profileName.askGender',
  goal: 'profileName.askGoal',
  career: 'profileName.askCareer',
  directions: 'profileName.askDirections',
  discovery: 'profileName.askDiscovery',
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },

  // pen 01 가입 시작 — 위에서 168(상태 막대 35 포함) 아래에 액티 127×142, 16 · 제목 26/800 · 8 · 설명 16/400 · 13 · 「1분이면 끝나요」.
  introCenter: { flex: 1, alignItems: 'center', paddingTop: 133, paddingHorizontal: 24 },
  introTitle: { marginTop: 16, fontSize: 26, fontWeight: '800', lineHeight: 35, color: palette.text, textAlign: 'center' },
  introBody: {
    marginTop: 8,
    maxWidth: 290,
    fontSize: 16,
    fontWeight: '400',
    lineHeight: 24,
    color: palette.textSub,
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
  // 아래 버튼 칸 — 좌우 24, 주 버튼 52, 버튼 사이 8.

  // 질문 화면 — 좌우 24. 말풍선 아래 답 칸까지 24, 고르는 줄 사이 8.
  body: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 10, paddingBottom: 24 },
  current: { marginTop: 24 },
  options: { gap: 8 },
  choice: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.bg,
  },
  choiceOn: { borderWidth: 1.5, borderColor: palette.blue, backgroundColor: palette.blueSoft },
  choicePressed: { opacity: 0.7 },
  choiceText: { flex: 1, fontSize: 16, fontWeight: '600', color: palette.text },
  choiceTextOn: { fontWeight: '700', color: palette.blueDeep },
  input: {
    height: 52,
    backgroundColor: palette.bgSoft,
    borderRadius: 16,
    paddingHorizontal: 16,
    fontSize: 16,
    fontWeight: '700',
    color: palette.text,
  },
  otherInput: { marginTop: 8 },
  fieldError: { marginTop: 8, fontSize: 13, color: palette.danger },
  error: { marginTop: 12, color: palette.danger, fontSize: 13 },
  loadError: { color: palette.danger, fontSize: 13, textAlign: 'center' },
});
