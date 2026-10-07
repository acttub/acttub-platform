/**
 * 상대역 목소리(reading.cast). 값은 기기에 내장된 Supertonic 프리셋 id(M1~M5·F1~F5)이고 서버는 목록을
 * 모른다(32자 이내 문자열이면 받는다). NULL 이면 "자동"이다.
 *
 * 읽을 목소리는 서버가 정해 `characters[].voice`로 준다(대본 전체 배역을 F1·M1·F2·M2·… 로 순환, 고정값은 순환에서 빠짐).
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

type VoicedCharacter = { id: string; voice_preset: string | null; voice: string };

/** 서버 VoiceAssignment 와 같은 순환. */
function rotate(characters: { id: string; voice_preset: string | null }[]): Record<string, VoicePreset> {
  let auto = 0;
  return Object.fromEntries(
    characters.map((c) => [c.id, isKnownPreset(c.voice_preset) ? c.voice_preset : AUTO_ROTATION[auto++ % AUTO_ROTATION.length]]),
  );
}

/**
 * 목소리 정하기(R3)에 보일 목소리. 고친 것이 없으면 서버 값(`voice`) 그대로다. 저장 전 선택은 서버에 물을 수 없어 서버와
 * 같은 순환으로 미리 센다 — 한 배역을 고정하면 뒤 배역의 자동 목소리가 당겨진다.
 */
export function shownVoices(characters: VoicedCharacter[], chosen: Record<string, string | null>): Record<string, VoicePreset> {
  if (voiceChanges(characters, chosen).length === 0) {
    return Object.fromEntries(characters.flatMap((c) => (isKnownPreset(c.voice) ? [[c.id, c.voice]] : [])));
  }
  return rotate(characters.map((c) => (c.id in chosen ? { ...c, voice_preset: chosen[c.id] } : c)));
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
