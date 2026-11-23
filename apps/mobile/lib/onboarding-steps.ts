import { NAME_MAX_LENGTH, checkBirthDate, type ProfileFormState } from './profile-form.ts';

/**
 * 가입 게이트 위저드(pen ①-1~⑧, SOMA-748)의 단계 규칙. 서버(PUT /v2/me/profile)가 받는 여섯 항목을 한 화면에 하나씩
 * 묻고, 어디서 알게 됐나(PUT /v2/me/discovery)는 물을 때만 맨 끝에 둔다. 저장은 끝에서 한 번이다(부분 저장 없음).
 *
 * pen 의 「요즘 연습 방식」「이루고 싶은 것」, 출생연도만 받기·건너뛰기, 연기 목표·경력 값 바꾸기는 서버가 바뀌어야 해서
 * 넣지 않았다. pen 에 없는 「추구하는 방향」은 서버 필수 항목이라 남겼다.
 */
export type OnboardingStep = 'name' | 'birth' | 'gender' | 'goal' | 'career' | 'directions' | 'discovery';

export function onboardingSteps(askDiscovery: boolean): OnboardingStep[] {
  const steps: OnboardingStep[] = ['name', 'birth', 'gender', 'goal', 'career', 'directions'];
  return askDiscovery ? [...steps, 'discovery'] : steps;
}

/** 다음 단계. 마지막이면 null(저장). */
export function stepAfter(steps: readonly OnboardingStep[], step: OnboardingStep): OnboardingStep | null {
  const index = steps.indexOf(step);
  return index >= 0 && index < steps.length - 1 ? steps[index + 1] : null;
}

/** 앞 단계. 첫 단계 앞은 시작 화면(intro)이다. */
export function stepBefore(steps: readonly OnboardingStep[], step: OnboardingStep): OnboardingStep | 'intro' {
  const index = steps.indexOf(step);
  return index > 0 ? steps[index - 1] : 'intro';
}

/**
 * 「다음」으로 못 넘어가는 이유(SOMA-1057). 글을 적는 칸(이름)은 버튼을 막지 않고 칸 아래 한 줄로 알리고,
 * 고르는 칸(생년월일·고르기)은 버튼을 회색으로 막는다(11/9 결정).
 */
export type StepBlock = 'name_empty' | 'name_too_long' | 'birth' | 'pick_one';

/** 그 단계를 못 넘어가는 이유. 넘어갈 수 있으면 null. 생년월일은 모양만 본다 — 나이는 누른 뒤 birthStepOutcome 이 가른다. */
export function stepBlockReason(step: OnboardingStep, form: ProfileFormState, now: Date): StepBlock | null {
  switch (step) {
    case 'name': {
      const name = form.name.trim();
      if (name.length === 0) return 'name_empty';
      return [...name].length > NAME_MAX_LENGTH ? 'name_too_long' : null;
    }
    case 'birth': {
      const check = checkBirthDate(form.birthDate, now);
      return check.kind === 'ok' || check.kind === 'under_minimum' ? null : 'birth';
    }
    case 'gender':
      return form.gender !== null ? null : 'pick_one';
    case 'goal':
      return form.goal !== null ? null : 'pick_one';
    case 'career':
      return form.experience !== null ? null : 'pick_one';
    case 'directions':
      return form.directions.length > 0 ? null : 'pick_one';
    case 'discovery':
      return null; // 선택 항목 — 고르지 않으면 건너뜀으로 적는다.
  }
}

/** 생년월일 단계에서 「계속하기」를 눌렀을 때. 만 14세 미만은 「가입할 수 없어요」로 간다. */
export function birthStepOutcome(birthDate: string, now: Date): 'next' | 'blocked' | 'invalid' {
  const check = checkBirthDate(birthDate, now);
  if (check.kind === 'ok') return 'next';
  if (check.kind === 'under_minimum') return 'blocked';
  return 'invalid';
}
