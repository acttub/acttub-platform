/**
 * 서버가 내려주는 앱 설정(SOMA-939) — 순수 모듈. RN 모듈에 기대지 않아 node 테스트로 잠근다.
 *
 * 운영이 손볼 만한 숫자·목록(평가 요청 주기, 리딩 침묵 감지, 함께 쓰기 칩, 홈 팁, 챌린지 길이)을 앱 출시 없이 바꾸려고
 * GET /v2/app/config 로 받는다. 기본값은 오늘까지 앱에 박혀 있던 값 그대로다 — 서버에 못 닿거나 칸이 빠지면 동작이 같다.
 * 값은 쓰는 순간 getAppConfig() 로 읽는다(모듈을 불러올 때 꺼내 두면 받아 온 값이 안 먹는다).
 */

import en from '../locales/en.ts';
import ko from '../locales/ko.ts';

export type AppConfig = {
  rating: {
    coachEvery: number;
    readingEvery: number;
    minGapDays: number;
    maxAsks: number;
  };
  reading: {
    vadThreshold: number;
    silenceMs: number;
    minSpeechMs: number;
    maxListenMs: number;
    speechEndGraceMs: number;
    advanceCoverage: number;
    monologuePass: number;
    monologueMissedBelow: number;
    monologueNextAt: number;
    monologueTouchMin: number;
  };
  cocreate: { emotions: string[]; situations: string[] };
  homeTips: { ko: string[]; en: string[] };
  challenge: { entryMinSeconds: number; entryMaxSeconds: number; durationsDays: number[] };
};

/** 오늘까지의 앱 값. */
export const DEFAULT_APP_CONFIG: AppConfig = {
  rating: { coachEvery: 2, readingEvery: 2, minGapDays: 7, maxAsks: 3 },
  reading: {
    vadThreshold: 0.015,
    silenceMs: 1800,
    minSpeechMs: 400,
    maxListenMs: 60000,
    speechEndGraceMs: 1300,
    advanceCoverage: 0.9,
    monologuePass: 0.72,
    monologueMissedBelow: 0.3,
    monologueNextAt: 0.8,
    monologueTouchMin: 3,
  },
  cocreate: {
    emotions: ['서운함', '설렘', '분노', '슬픔', '긴장', '담담함'],
    situations: ['오랜만의 재회', '이별', '오디션 직전', '가족 다툼', '고백', '사과'],
  },
  // 홈 팁 기본값은 locales 의 home.tips 그대로다 — 문구 정본을 두 곳에 두지 않는다.
  homeTips: { ko: [...ko.home.tips], en: [...en.home.tips] },
  challenge: { entryMinSeconds: 3, entryMaxSeconds: 60, durationsDays: [7, 14] },
};

// ─── 검증 ─────────────────────────────────────────────────────────────────────

type Obj = Record<string, unknown>;

function obj(value: unknown): Obj {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Obj) : {};
}

/** 0보다 큰 유한한 수. 상한이 있으면 그 이하. */
function positive(value: unknown, fallback: number, max = Number.POSITIVE_INFINITY): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= max ? value : fallback;
}

/** 0보다 큰 정수. */
function positiveInt(value: unknown, fallback: number, max = Number.POSITIVE_INFINITY): number {
  return Number.isInteger(value) && (value as number) > 0 && (value as number) <= max ? (value as number) : fallback;
}

/** 0 초과 1 이하 비율. */
function ratio(value: unknown, fallback: number): number {
  return positive(value, fallback, 1);
}

/** 빈 글이 없는 비지 않은 글 목록. 하나라도 이상하면 통째로 기본값이다. */
function strings(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value) || value.length === 0) return fallback;
  if (!value.every((s) => typeof s === 'string' && s.trim().length > 0)) return fallback;
  return value as string[];
}

function positiveInts(value: unknown, fallback: number[]): number[] {
  if (!Array.isArray(value) || value.length === 0) return fallback;
  if (!value.every((n) => Number.isInteger(n) && n > 0 && n <= 365)) return fallback;
  return value as number[];
}

/** 서버 응답(snake_case)을 칸마다 검사한다. 빠지거나 이상한 칸만 기본값으로 — 던지지 않는다. */
export function parseAppConfig(json: unknown): AppConfig {
  const d = DEFAULT_APP_CONFIG;
  const root = obj(json);
  const rating = obj(root.rating);
  const reading = obj(root.reading);
  const cocreate = obj(root.cocreate);
  const tips = obj(root.home_tips);
  const challenge = obj(root.challenge);

  const entryMinSeconds = positiveInt(challenge.entry_min_seconds, d.challenge.entryMinSeconds, 600);
  let entryMaxSeconds = positiveInt(challenge.entry_max_seconds, d.challenge.entryMaxSeconds, 600);
  // 상한이 하한보다 작으면 올릴 수 있는 영상이 없다 — 상한을 기본값으로 되돌린다.
  if (entryMaxSeconds < entryMinSeconds) entryMaxSeconds = Math.max(d.challenge.entryMaxSeconds, entryMinSeconds);

  return {
    rating: {
      coachEvery: positiveInt(rating.coach_every, d.rating.coachEvery, 1000),
      readingEvery: positiveInt(rating.reading_every, d.rating.readingEvery, 1000),
      minGapDays: positive(rating.min_gap_days, d.rating.minGapDays, 3650),
      maxAsks: positiveInt(rating.max_asks, d.rating.maxAsks, 1000),
    },
    reading: {
      vadThreshold: ratio(reading.vad_threshold, d.reading.vadThreshold),
      silenceMs: positive(reading.silence_ms, d.reading.silenceMs, 60_000),
      minSpeechMs: positive(reading.min_speech_ms, d.reading.minSpeechMs, 60_000),
      maxListenMs: positive(reading.max_listen_ms, d.reading.maxListenMs, 600_000),
      speechEndGraceMs: positive(reading.speech_end_grace_ms, d.reading.speechEndGraceMs, 60_000),
      advanceCoverage: ratio(reading.advance_coverage, d.reading.advanceCoverage),
      monologuePass: ratio(reading.monologue_pass, d.reading.monologuePass),
      monologueMissedBelow: ratio(reading.monologue_missed_below, d.reading.monologueMissedBelow),
      monologueNextAt: ratio(reading.monologue_next_at, d.reading.monologueNextAt),
      monologueTouchMin: positiveInt(reading.monologue_touch_min, d.reading.monologueTouchMin, 100),
    },
    cocreate: {
      emotions: strings(cocreate.emotions, d.cocreate.emotions),
      situations: strings(cocreate.situations, d.cocreate.situations),
    },
    homeTips: {
      ko: strings(tips.ko, d.homeTips.ko),
      en: strings(tips.en, d.homeTips.en),
    },
    challenge: {
      entryMinSeconds,
      entryMaxSeconds,
      durationsDays: positiveInts(challenge.durations_days, d.challenge.durationsDays),
    },
  };
}

// ─── 지금 쓰는 설정 ───────────────────────────────────────────────────────────

let current: AppConfig = DEFAULT_APP_CONFIG;
const listeners = new Set<() => void>();

/** 지금 쓰는 설정. 받아 오기 전에는 기본값이다. */
export function getAppConfig(): AppConfig {
  return current;
}

export function setAppConfig(next: AppConfig): void {
  current = next;
  for (const listener of listeners) listener();
}

/** 설정이 바뀌면 부른다 — 화면이 다시 그릴 때 쓴다. */
export function subscribeAppConfig(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
