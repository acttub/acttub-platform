import { classifyUnprocessable } from './api-request.ts';
import type { ProfileGateStatus } from './app-bootstrap.ts';

/**
 * 프로필 여섯 항목의 순수 로직(account.profile). 가입 게이트의 입력 화면(A0.2)과 설정의
 * 수정이 같은 폼과 같은 API(PUT /v2/me/profile)를 쓴다. 부분 저장은 없다.
 *
 * 값 이름은 서버의 허용값과 같다. 화면 문구는 locales의 profileName에 있다.
 */
export const GENDER_VALUES = ['female', 'male', 'unspecified'] as const;
export const DIRECTION_VALUES = ['media', 'stage'] as const;
export const EXPERIENCE_VALUES = [
  'before_start',
  'exam_prep',
  'under_1y',
  'y1_to_3',
  'y3_to_5',
  'over_5y',
] as const;
export const GOAL_VALUES = ['hobby', 'audition', 'professional'] as const;

export type Gender = (typeof GENDER_VALUES)[number];
export type Direction = (typeof DIRECTION_VALUES)[number];
export type Experience = (typeof EXPERIENCE_VALUES)[number];
export type Goal = (typeof GOAL_VALUES)[number];

export const NAME_MAX_LENGTH = 20;

/** GET /v2/me의 profile. 1.0.0 이전 회원은 name(옛 닉네임)만 있고 나머지는 null이다. */
export type ServerProfile = {
  name: string | null;
  gender: Gender | null;
  birth_date: string | null;
  age?: number | null;
  directions: Direction[];
  experience: Experience | null;
  goal: Goal | null;
  photo_url?: string | null;
  bio?: string | null;
};

export type ProfileFormState = {
  name: string;
  gender: Gender | null;
  /** 입력 중인 글자 그대로. 완성되면 YYYY-MM-DD다. */
  birthDate: string;
  directions: Direction[];
  experience: Experience | null;
  goal: Goal | null;
};

export type ProfilePayload = {
  name: string;
  gender: Gender;
  birth_date: string;
  directions: Direction[];
  experience: Experience;
  goal: Goal;
  bio?: string | null;
};

/**
 * 이름 칸의 첫 값: 서버에 있는 이름(1.0.0 이전 회원의 옛 닉네임)이 먼저고, 없으면 제공자가
 * 준 이름이다. 미리 채우는 값일 뿐이고 저장되는 것은 배우가 확인한 값이다.
 */
export function initialProfileForm(
  profile: ServerProfile | null | undefined,
  providerName: string | null | undefined,
): ProfileFormState {
  return {
    name: profile?.name?.trim() || providerName?.trim() || '',
    gender: profile?.gender ?? null,
    birthDate: profile?.birth_date ?? '',
    directions: [...(profile?.directions ?? [])],
    experience: profile?.experience ?? null,
    goal: profile?.goal ?? null,
  };
}

/** 숫자만 남겨 YYYY-MM-DD로 끊는다. 숫자 키패드로 여덟 자리를 이어 치면 된다. */
export function formatBirthDateInput(text: string): string {
  const digits = text.replace(/[^0-9]/g, '').slice(0, 8);
  return [digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8)]
    .filter((part) => part.length > 0)
    .join('-');
}

function koreaDate(now: Date): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * 실제로 있는 지난 날짜면 그대로, 아니면 null. 서버에서 본문 모양 오류(422 배열)가 될 입력만
 * 거른다. 만 14세 미만인지는 여기서 보지 않는다 — 서버가 한국 시간의 날짜로 판정한다.
 */
export function parseBirthDate(text: string, now: Date): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 1900) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  const value = match[0];
  return value <= koreaDate(now) ? value : null;
}

function trimmedName(form: ProfileFormState): string | null {
  const name = form.name.trim();
  return name.length >= 1 && [...name].length <= NAME_MAX_LENGTH ? name : null;
}

export function isProfileFormComplete(form: ProfileFormState, now: Date): boolean {
  return (
    trimmedName(form) !== null &&
    form.gender !== null &&
    parseBirthDate(form.birthDate, now) !== null &&
    form.directions.length > 0 &&
    form.experience !== null &&
    form.goal !== null
  );
}

/**
 * 저장 요청 본문. `extras.bio`는 설정에서 고칠 때만 넘긴다 — 받아 둔 한 줄 소개를 그대로
 * 실어 여섯 항목 저장이 소개를 지우지 않게 한다. 가입 게이트에서는 키를 싣지 않는다.
 */
export function buildProfilePayload(
  form: ProfileFormState,
  now: Date,
  extras?: { bio: string | null },
): ProfilePayload {
  const name = trimmedName(form);
  const birthDate = parseBirthDate(form.birthDate, now);
  if (
    name === null ||
    birthDate === null ||
    form.gender === null ||
    form.directions.length === 0 ||
    form.experience === null ||
    form.goal === null
  ) {
    throw new Error('프로필 여섯 항목을 모두 채워야 저장할 수 있어요.');
  }
  return {
    name,
    gender: form.gender,
    birth_date: birthDate,
    directions: DIRECTION_VALUES.filter((direction) => form.directions.includes(direction)),
    experience: form.experience,
    goal: form.goal,
    ...(extras ? { bio: extras.bio } : {}),
  };
}

/** 서버의 profile_complete가 정본이다. 값이 없으면 통과시키지 않는다. */
export function profileGateStatus(me: { profile_complete?: boolean }): Extract<
  ProfileGateStatus,
  'required' | 'complete'
> {
  return me.profile_complete === true ? 'complete' : 'required';
}

export type ProfileSaveFailure =
  /** 가입 게이트에서 만 14세 미만. 서버가 계정을 닫았고 토큰도 죽었다. */
  | { kind: 'account_closed' }
  /** 설정에서 고친 생년월일이 만 14세 미만. 계정과 옛 값은 그대로다. */
  | { kind: 'under_14' }
  /** 본문 모양이 틀린 422(배열). 화면 검증이 놓친 앱 버그다. */
  | { kind: 'client_bug' }
  | { kind: 'retry' };

export function profileSaveFailure(error: unknown): ProfileSaveFailure {
  const unprocessable = classifyUnprocessable(error);
  if (unprocessable?.kind === 'client_bug') return { kind: 'client_bug' };
  if (unprocessable?.kind === 'reason') {
    if (unprocessable.code === 'under_14_account_closed') return { kind: 'account_closed' };
    if (unprocessable.code === 'under_14') return { kind: 'under_14' };
  }
  return { kind: 'retry' };
}
