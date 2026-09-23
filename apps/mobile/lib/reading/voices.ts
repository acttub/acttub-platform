/**
 * 상대역 목소리(reading.cast). 값은 기기에 내장된 Supertonic 프리셋 id(M1~M5·F1~F5)이고 서버는 목록을
 * 모른다(32자 이내 문자열이면 받는다). NULL 이면 "자동"이다.
 *
 * 자동 규칙: 회차마다 내 배역을 뺀 상대역을 등장 순서로 세워 F1·M1·F2·M2·… 를 순환 배정한다(웹과 같다).
 * 배우가 고른 배역만 고정값이 되고 자동 배정에서 빠진다. 같은 프리셋을 여러 배역에 줄 수 있고, 기기가
 * 모르는 값은 자동으로 다룬다.
 */
export const VOICE_PRESETS = ['M1', 'M2', 'M3', 'M4', 'M5', 'F1', 'F2', 'F3', 'F4', 'F5'] as const;
export type VoicePreset = (typeof VOICE_PRESETS)[number];

/** 남녀가 번갈아 나오도록 섞어 둔다 — 등장 순서대로 집으면 대개 대화처럼 들린다. */
export const AUTO_ROTATION: VoicePreset[] = ['F1', 'M1', 'F2', 'M2', 'F3', 'M3', 'F4', 'M4', 'F5', 'M5'];

export const VOICE_PRESET_MAX_LENGTH = 32;

export function isKnownPreset(value: unknown): value is VoicePreset {
  return typeof value === 'string' && (VOICE_PRESETS as readonly string[]).includes(value);
}

type VoicedCharacter = { id: string; voice_preset: string | null };

/**
 * 회차의 상대역마다 읽을 프리셋. 내 배역은 들어 있지 않다(그 회차에서 쓰이지 않는다).
 * 배열 순서가 등장 순서다.
 */
export function assignVoices(characters: VoicedCharacter[], myCharacterIds: string[]): Record<string, VoicePreset> {
  const mine = new Set(myCharacterIds);
  const partners = characters.filter((c) => !mine.has(c.id));
  const out: Record<string, VoicePreset> = {};
  let auto = 0;
  for (const c of partners) {
    if (isKnownPreset(c.voice_preset)) {
      out[c.id] = c.voice_preset;
    } else {
      out[c.id] = AUTO_ROTATION[auto % AUTO_ROTATION.length];
      auto += 1;
    }
  }
  return out;
}

/** 서버 규칙과 같다 — 32자를 넘으면 422 invalid_characters. */
export function presetError(value: string): 'invalid_characters' | null {
  return [...value].length > VOICE_PRESET_MAX_LENGTH ? 'invalid_characters' : null;
}

/** 화면의 드롭다운 값 → 저장값. "자동"·빈 값은 null(자동). */
export function normalizePresetValue(value: string | null | undefined): string | null {
  const v = (value ?? '').trim();
  if (!v || v.toLowerCase() === 'auto') return null;
  return v;
}

/** 기기 음성 대체(expo-speech)의 높낮이. 여성 프리셋이 높다. 모르는 값은 기본 1. */
const DEVICE_PITCH: Record<VoicePreset, number> = {
  F1: 1.15,
  F2: 1.2,
  F3: 1.1,
  F4: 1.25,
  F5: 1.05,
  M1: 0.9,
  M2: 0.85,
  M3: 0.95,
  M4: 0.8,
  M5: 1.0,
};

export function devicePitchFor(preset: string): number {
  return isKnownPreset(preset) ? DEVICE_PITCH[preset] : 1;
}
