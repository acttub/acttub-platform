import { translate } from '../i18n.ts';

/**
 * 상대역 목소리(reading.cast). 값은 기기에 내장된 Supertonic 프리셋 id(M1~M5·F1~F5)이고 서버는 목록을
 * 모른다(32자 이내 문자열이면 받는다). NULL 이면 "자동"이다.
 *
 * 읽을 목소리는 서버가 정해 `characters[].voice`로 준다(성별·나이대가 있으면 그에 맞게, 없으면 F1·M1·F2·M2·… 순환, 고정값과 겹치지 않게).
 * 기기는 그 회차의 내 배역만 빼고 그대로 읽는다. 순환을 기기도 아는 것은 목소리 정하기(R3)가 저장 전 선택을 미리 보이기
 * 때문이다. 같은 프리셋을 여러 배역에 줄 수 있고, 기기가 모르는 값은 자동으로 다룬다.
 */
const VOICE_PRESETS = ['M1', 'M2', 'M3', 'M4', 'M5', 'F1', 'F2', 'F3', 'F4', 'F5'] as const;
export type VoicePreset = (typeof VOICE_PRESETS)[number];

/** 남녀가 번갈아 나오도록 섞어 둔다 — 배역 순서대로 집으면 대개 대화처럼 들린다. */
const AUTO_ROTATION: VoicePreset[] = ['F1', 'M1', 'F2', 'M2', 'F3', 'M3', 'F4', 'M4', 'F5', 'M5'];

export function isKnownPreset(value: unknown): value is VoicePreset {
  return typeof value === 'string' && (VOICE_PRESETS as readonly string[]).includes(value);
}

type VoicedCharacter = {
  id: string;
  voice_preset: string | null;
  voice: string;
  /** 서버가 대본에서 뽑은 성별·나이대(SOMA-670). 모르면 null/없음. */
  gender?: 'm' | 'f' | null;
  age_band?: 'child' | 'young' | 'adult' | 'senior' | null;
};

/**
 * 성별·나이대별 자동 목소리 후보 — 서버 VoiceAssignment 와 같은 표(SOMA-670). 프리셋 10개의 음높이를 재서 정했다
 * (M1·F2 가 가장 높고 넓은 억양, M5·F5 가 가장 낮고 좁다). 아이는 청년 목록을 쓴다.
 */
const PREFERENCE: Record<'m' | 'f', Record<'young' | 'adult' | 'senior' | 'unknown', VoicePreset[]>> = {
  m: {
    young: ['M1', 'M4', 'M3', 'M2', 'M5'],
    adult: ['M3', 'M4', 'M2', 'M1', 'M5'],
    senior: ['M5', 'M2', 'M3', 'M4', 'M1'],
    unknown: ['M1', 'M3', 'M4', 'M2', 'M5'],
  },
  f: {
    young: ['F2', 'F4', 'F1', 'F3', 'F5'],
    adult: ['F1', 'F3', 'F4', 'F5', 'F2'],
    senior: ['F5', 'F3', 'F1', 'F4', 'F2'],
    unknown: ['F1', 'F2', 'F3', 'F4', 'F5'],
  },
};

/**
 * 서버 VoiceAssignment 와 같은 배정. 고정한 목소리는 쓴 것으로 치고, 자동 배역은 순서대로 — 성별을 알면 그 목록에서 아직
 * 안 쓴 첫 목소리(다 썼으면 첫 목소리), 모르면 예전 순환에서 아직 안 쓴 다음 목소리(다 썼으면 순환 그대로)를 받는다.
 */
function assign(characters: (Omit<VoicedCharacter, 'voice'>)[]): Record<string, VoicePreset> {
  const used = new Set<VoicePreset>(characters.flatMap((c) => (isKnownPreset(c.voice_preset) ? [c.voice_preset] : [])));
  let ptr = 0;
  const out: Record<string, VoicePreset> = {};
  for (const c of characters) {
    if (isKnownPreset(c.voice_preset)) {
      out[c.id] = c.voice_preset;
      continue;
    }
    let pick: VoicePreset;
    if (c.gender === 'm' || c.gender === 'f') {
      const age = c.age_band === 'child' ? 'young' : c.age_band ?? 'unknown';
      const list = PREFERENCE[c.gender][age];
      pick = list.find((v) => !used.has(v)) ?? list[0];
    } else {
      const n = AUTO_ROTATION.length;
      const k = Array.from({ length: n }, (_, i) => i).find((i) => !used.has(AUTO_ROTATION[(ptr + i) % n]));
      if (k === undefined) {
        pick = AUTO_ROTATION[ptr % n];
        ptr += 1;
      } else {
        pick = AUTO_ROTATION[(ptr + k) % n];
        ptr += k + 1;
      }
    }
    used.add(pick);
    out[c.id] = pick;
  }
  return out;
}

/**
 * 목소리 정하기(R3)에 보일 목소리. 고친 것이 없으면 서버 값(`voice`) 그대로다. 저장 전 선택은 서버에 물을 수 없어 서버와
 * 같은 순환으로 미리 센다 — 한 배역을 고정하면 뒤 배역의 자동 목소리가 당겨진다.
 */
export function shownVoices(characters: VoicedCharacter[], chosen: Record<string, string | null>): Record<string, VoicePreset> {
  if (voiceChanges(characters, chosen).length === 0) {
    return Object.fromEntries(characters.flatMap((c) => (isKnownPreset(c.voice) ? [[c.id, c.voice]] : [])));
  }
  return assign(characters.map((c) => (c.id in chosen ? { ...c, voice_preset: chosen[c.id] } : c)));
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

/** 이 배역을 자동으로 두면 받을 목소리 — 목소리 시트의 「자동 (지금 M1)」. */
export function autoVoiceOf(
  characters: VoicedCharacter[],
  chosen: Record<string, string | null>,
  characterId: string,
): VoicePreset | undefined {
  return shownVoices(characters, { ...chosen, [characterId]: null })[characterId];
}

/** 화면에서 고른 값(배역 id → 프리셋, null=자동) 가운데 저장된 값과 다른 것만 — 목소리 정하기 [저장]이 보낸다. */
export function voiceChanges(
  characters: VoicedCharacter[],
  chosen: Record<string, string | null>,
): { id: string; voice_preset: string | null }[] {
  return characters.filter((c) => c.id in chosen && chosen[c.id] !== c.voice_preset).map((c) => ({ id: c.id, voice_preset: chosen[c.id] }));
}

/** 화면에 보일 목소리 이름 — 코드(M1·F5) 대신 목소리 느낌(SOMA-670). 기기가 모르는 값은 그대로 보인다. */
export function voiceName(preset: string | null | undefined): string {
  if (!preset) return '-';
  return isKnownPreset(preset) ? translate(`reading.voiceName.${preset}`) : preset;
}

export type VoiceGender = 'm' | 'f';

export function genderOfVoice(preset: VoicePreset): VoiceGender {
  return preset.startsWith('M') ? 'm' : 'f';
}

export const VOICES_BY_GENDER: Record<VoiceGender, VoicePreset[]> = {
  m: ['M1', 'M4', 'M3', 'M2', 'M5'],
  f: ['F2', 'F4', 'F1', 'F3', 'F5'],
};

export function recommendedVoice(
  characters: VoicedCharacter[],
  chosen: Record<string, string | null>,
  characterId: string,
  gender: VoiceGender,
): VoicePreset {
  const shown = shownVoices(characters, chosen);
  const taken = new Set(characters.filter((c) => c.id !== characterId).map((c) => shown[c.id]));
  const band = characters.find((c) => c.id === characterId)?.age_band;
  const list = PREFERENCE[gender][band === 'child' ? 'young' : band ?? 'unknown'];
  return list.find((v) => !taken.has(v)) ?? list[0];
}

export function voiceChoice(
  characters: VoicedCharacter[],
  chosen: Record<string, string | null>,
  characterId: string,
  preset: VoicePreset,
): VoicePreset | null {
  return autoVoiceOf(characters, chosen, characterId) === preset ? null : preset;
}

export function switchGender(
  characters: VoicedCharacter[],
  chosen: Record<string, string | null>,
  characterId: string,
): VoicePreset | null {
  const now = shownVoices(characters, chosen)[characterId];
  const target: VoiceGender = now && genderOfVoice(now) === 'm' ? 'f' : 'm';
  return voiceChoice(characters, chosen, characterId, recommendedVoice(characters, chosen, characterId, target));
}
