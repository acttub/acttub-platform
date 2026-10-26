/**
 * 찍을 대사 같이 만들기(SOMA-721) — 서버 /v2/sample-scripts 의 모양과 화면이 쓰는 순수 규칙.
 *
 * 분량은 서버가 대사 5자 = 1초로 어림한 추정치다. 실제 낭독 시간으로 보정한 값이 아니므로 「약 1분」처럼만 보인다.
 */

export type SampleScriptExperience = 'beginner' | 'exam' | 'experienced';

export type SampleScriptCharacter = { name: string; gender: string | null; age_band: string | null; mine: boolean };
export type SampleScriptLine = { kind: 'scene' | 'direction' | 'dialogue'; character: string | null; text: string };

export type SampleScript = {
  id: string;
  version: number;
  version_count: number;
  title: string;
  scene: string;
  characters: SampleScriptCharacter[];
  lines: SampleScriptLine[];
  design: {
    relation: string;
    incident: string;
    prop: string;
    my_objective: string;
    other_reason: string;
    turn_action: string;
  };
  emotion: string;
  situation: string;
  character_count: number;
  length_minutes: number;
  estimated_seconds: number;
  revisions_used: number;
  revisions_left: number;
  note: string | null;
  script_id: string | null;
  created_at: string;
};

export type CreateSampleScriptBody = {
  request_id: string;
  experience?: SampleScriptExperience | null;
  age?: number | null;
  gender?: 'female' | 'male' | 'unspecified' | null;
  goal?: 'hobby' | 'audition' | 'professional' | null;
  emotion?: string | null;
  situation?: string | null;
  direction?: string | null;
  character_count: number;
  length_minutes: number;
};

export type ReviseSampleScriptBody = {
  base_version: number;
  text?: string | null;
  character_count?: number | null;
  length_minutes?: number | null;
};

/** 감정 칩(서버의 고정 목록과 같다) + 「잘 모르겠어요」. 보이는 순서는 pen P14.1(서운함부터). */
export const EMOTIONS = ['서운함', '설렘', '분노', '슬픔', '긴장', '담담함'] as const;
export const ANY_EMOTION = '잘 모르겠어요';
/** 상황 칩(pen P14.2) — 고르거나 직접 쓴다. 「아무거나 좋아요」면 서버가 고른다. 서버는 자유 글로 받는다. */
export const SITUATIONS = ['오랜만의 재회', '이별', '오디션 직전', '가족 다툼', '고백', '사과'] as const;
export const ANY_SITUATION = '아무거나 좋아요';
/** 코칭은 혼자 찍으므로 독백이 기본이다. 2인은 상대역 대사가 있는 장면. */
export const CAST_OPTIONS = [1, 2] as const;
/** 찍기에 맞는 분량만 보인다(서버는 10분도 받는다). */
export const LENGTH_OPTIONS = [1, 3] as const;
export const FREE_TEXT_MAX = { situation: 200, direction: 300, revision: 500 } as const;

/** 프로필 경력(가입 답) → 서버의 세 갈래. 모르면 입문. */
export function experienceFor(profileExperience: string | null | undefined): SampleScriptExperience {
  if (profileExperience === 'exam_prep') return 'exam';
  if (profileExperience === 'y1_to_3' || profileExperience === 'y3_to_5' || profileExperience === 'over_5y') return 'experienced';
  return 'beginner';
}

/** 「약 1분」·「약 40초」. 서버의 추정 초를 30초 단위로 둥글린다. */
export function durationLabel(seconds: number): string {
  if (seconds < 45) return `약 ${Math.max(10, Math.round(seconds / 10) * 10)}초`;
  const halves = Math.round(seconds / 30);
  const minutes = Math.floor(halves / 2);
  return halves % 2 === 0 ? `약 ${minutes}분` : `약 ${minutes}분 30초`;
}

/** 결과 머리의 한 줄 — 「지민 · 독백 · 약 1분」·「지민 · 민호 · 2인 대화 · 약 1분」. */
export function summaryLine(script: Pick<SampleScript, 'characters' | 'estimated_seconds'>): string {
  const names = script.characters.map((c) => c.name);
  const kind = names.length === 1 ? '독백' : `${names.length}인 대화`;
  return [...names, kind, durationLabel(script.estimated_seconds)].join(' · ');
}

export function myRole(script: Pick<SampleScript, 'characters'>): string {
  return script.characters.find((c) => c.mine)?.name ?? script.characters[0]?.name ?? '';
}

const SCENE_MAX = 300;

/**
 * 「지금 찍을래요」 — 새 연습의 장면 칸(상황·인물·원하는 것)에 생성 대본의 장면 정보를 채운다. 코치는 이 장면 칸을 읽는다.
 * 상황은 제목·장소와 직전 사건, 인물은 내 배역과 관계, 원하는 것은 설계도의 목표다.
 */
export function coachSceneFor(script: Pick<SampleScript, 'title' | 'scene' | 'characters' | 'design'>): {
  situation: string;
  character: string;
  goal: string;
} {
  const situation = [script.title, script.scene, script.design.incident].filter((s) => s && s.trim()).join(' · ');
  const role = myRole(script);
  const character = script.design.relation ? `${role} (${script.design.relation})` : role;
  return {
    situation: situation.slice(0, SCENE_MAX),
    character: character.slice(0, SCENE_MAX),
    goal: (script.design.my_objective ?? '').slice(0, SCENE_MAX),
  };
}

/** 수정 화면의 「수정 적용」을 누를 수 있는가 — 무엇이든 바뀌어야 한다. 고르기만으로는 부르지 않는다. */
export function revisionChanged(
  script: Pick<SampleScript, 'character_count' | 'length_minutes'>,
  draft: { text: string; characterCount: number; minutes: number },
): boolean {
  return draft.text.trim().length > 0 || draft.characterCount !== script.character_count || draft.minutes !== script.length_minutes;
}

export function revisionBody(
  script: Pick<SampleScript, 'version' | 'character_count' | 'length_minutes'>,
  draft: { text: string; characterCount: number; minutes: number },
): ReviseSampleScriptBody {
  const body: ReviseSampleScriptBody = { base_version: script.version };
  const text = draft.text.trim();
  if (text) body.text = text;
  if (draft.characterCount !== script.character_count) body.character_count = draft.characterCount;
  if (draft.minutes !== script.length_minutes) body.length_minutes = draft.minutes;
  return body;
}

/** 서버 오류 코드 → 화면 문구 키. 모르는 오류는 일반 실패. */
export function errorKey(code: string | undefined): string {
  switch (code) {
    case 'sample_script_revision_limit':
      return 'scriptCocreate.errorRevisionLimit';
    case 'sample_script_daily_limit':
      return 'scriptCocreate.errorDailyLimit';
    case 'sample_script_in_progress':
    case 'sample_script_busy':
      return 'scriptCocreate.errorBusy';
    case 'sample_script_version_conflict':
      return 'scriptCocreate.errorConflict';
    case 'sample_script_revision_failed':
      return 'scriptCocreate.errorRevision';
    case 'script_limit':
      return 'scriptCocreate.errorScriptLimit';
    // 무료 대본 1개(SOMA-818) — 서버 무료 한도 플래그가 켜졌을 때만 온다.
    case 'free_script_limit':
      return 'pro.scriptLimitTitle';
    default:
      return 'scriptCocreate.errorGenerate';
  }
}

/** 무료로 고치거나 다시 만들 수 있는 횟수(대본 하나 기준). */
export const FREE_REVISIONS = 3;

/** 결과 화면의 수정 칩 — 누르면 이 지시로 고친다. */
export const REVISION_CHIPS = ['shorter', 'stronger', 'moreMine'] as const;
export type RevisionChip = (typeof REVISION_CHIPS)[number];

/**
 * 「다시 만들기 · 무료 3번 중 N번 남음」의 N. 서버가 revisions_left 를 주면 그 값, 안 주면 앱이 센 횟수로 3번에서 뺀다.
 * 다시 만들면 서버 대본이 새로 생기므로, 앱이 센 다시 만들기 횟수가 더 많으면 그쪽을 따른다.
 */
export function freeLeft(serverLeft: number | null | undefined, usedHere: number): number {
  const local = Math.max(0, FREE_REVISIONS - usedHere);
  return typeof serverLeft === 'number' ? Math.max(0, Math.min(serverLeft, local)) : local;
}

/**
 * 대본 생성은 1분을 넘기도 한다. 앱이 받는 길(웹 프록시 60초)이 먼저 끊겨 500이 와도 서버는 끝까지 만들어 저장하고,
 * 같은 요청 id로 다시 물으면 만드는 중엔 409 sample_script_in_progress, 끝났으면 저장된 대본을 준다(10/23 실기기 확인).
 * 그래서 이런 실패는 실패 화면을 띄우지 않고 기다렸다 다시 묻는다. 입력이 틀렸거나(4xx) 시간이 다 되면 그대로 던진다.
 */
export function shouldWaitForGeneration(error: unknown): boolean {
  const e = error as { status?: unknown; code?: unknown } | null;
  if (!e || typeof e !== 'object') return false;
  if (e.code === 'sample_script_in_progress') return true;
  if (e.code === 'network_error') return true;
  return typeof e.status === 'number' && e.status >= 500;
}

export async function generateWithWait<T>(
  call: () => Promise<T>,
  options: { deadlineMs: number; intervalMs: number; now?: () => number; sleep?: (ms: number) => Promise<void> },
): Promise<T> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const startedAt = now();
  for (;;) {
    try {
      return await call();
    } catch (error) {
      if (!shouldWaitForGeneration(error) || now() - startedAt + options.intervalMs > options.deadlineMs) throw error;
      await sleep(options.intervalMs);
    }
  }
}
