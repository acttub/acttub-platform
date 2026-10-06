/**
 * 상대역 목소리(reading.cast). 서버가 배역마다 「내 배역이 아닐 때 읽을 목소리」(characters[].voice)를 정해 주고,
 * 기기는 이번 회차의 내 배역만 빼고 그 값으로 읽는다. 그래서 내 배역을 바꿔도 같은 배역은 같은 목소리다.
 */
import type { VoicePreset } from "@/lib/reading/audio/supertonic/models";
import { deviceStyles, type RoleVoice } from "@/lib/reading/audio/tts";

export interface CastCharacter {
  id: string;
  name: string;
  /** script_characters.voice_preset. null 이면 자동. */
  voicePreset: string | null;
  /** 서버가 정한 목소리. 고정값이면 그 값, 자동이면 대본 전체 배역으로 돌린 값이다. */
  voice: VoicePreset;
}

/** 실행 화면이 배역 이름으로 찾는 상대역 목소리 표. 내 배역은 들지 않는다. */
export function voicesFor(
  script: { characters: CastCharacter[] },
  myCharacterIds: string[],
): Record<string, RoleVoice> {
  const mine = new Set(myCharacterIds);
  const partners = script.characters.filter((c) => !mine.has(c.id));
  const device = deviceStyles(partners.map((c) => c.name));
  return Object.fromEntries(partners.map((c) => [c.name, { device: device[c.name], preset: c.voice }]));
}
