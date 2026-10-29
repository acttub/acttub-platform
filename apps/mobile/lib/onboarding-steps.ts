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

/** 그 단계의 「계속하기」를 켤 수 있나. 생년월일은 모양만 본다 — 나이는 누른 뒤 birthStepOutcome 이 가른다. */
export function stepReady(step: OnboardingStep, form: ProfileFormState, now: Date): boolean {
  switch (step) {
    case 'name': {
      const name = form.name.trim();
      return name.length > 0 && [...name].length <= NAME_MAX_LENGTH;
    }
    case 'birth': {
      const check = checkBirthDate(form.birthDate, now);
      return check.kind === 'ok' || check.kind === 'under_minimum';
    }
    case 'gender':
      return form.gender !== null;
    case 'goal':
      return form.goal !== null;
    case 'career':
      return form.experience !== null;
    case 'directions':
      return form.directions.length > 0;
    case 'discovery':
      return true; // 선택 항목 — 고르지 않으면 건너뜀으로 적는다.
  }
}

/** 생년월일 단계에서 「계속하기」를 눌렀을 때. 만 14세 미만은 「가입할 수 없어요」로 간다. */
export function birthStepOutcome(birthDate: string, now: Date): 'next' | 'blocked' | 'invalid' {
  const check = checkBirthDate(birthDate, now);
  if (check.kind === 'ok') return 'next';
  if (check.kind === 'under_minimum') return 'blocked';
  return 'invalid';
}

/**
 * 한 질문에 답한 뒤 갈 곳(SOMA-790, 토스식 가입). 그 뒤에서 처음으로 아직 안 답한 질문, 없으면 앞에서 처음 안 답한
 * 질문이다. 다 답했으면 null(저장). 답한 칸을 눌러 고치러 돌아갔다가 다시 답하면 하던 질문으로 돌아온다.
 */
export function nextOpenStep(
  steps: readonly OnboardingStep[],
  done: ReadonlySet<OnboardingStep>,
  from: OnboardingStep,
): OnboardingStep | null {
  const open = (step: OnboardingStep) => step !== from && !done.has(step);
  const index = steps.indexOf(from);
  return steps.slice(index + 1).find(open) ?? steps.slice(0, index).find(open) ?? null;
}
