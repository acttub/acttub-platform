/**
 * 상대역 목소리 배정(reading.cast). 배역의 voice_preset 이 있으면 그대로(고정값), 없으면 내 배역을 뺀
 * 상대역을 등장 순서로 세워 F1·M1·F2·M2·… 를 순환 배정한다. 고정한 배역은 순환에서 빠지고, 같은
 * 프리셋을 여러 배역에 줄 수 있다. 기기가 모르는 값은 자동으로 다룬다.
 */
import { VOICE_PRESETS, type VoicePreset } from "@/lib/reading/audio/supertonic/models";
import { assignVoices, type RoleVoice } from "@/lib/reading/audio/tts";

/** 남녀가 번갈아 나오도록 섞어 둔 순환 순서(웹 현행 방식) */
export const PRESET_CYCLE: VoicePreset[] = ["F1", "M1", "F2", "M2", "F3", "M3", "F4", "M4", "F5", "M5"];

export function isVoicePreset(value: string | null | undefined): value is VoicePreset {
  return typeof value === "string" && (VOICE_PRESETS as readonly string[]).includes(value);
}

export interface CastCharacter {
  id: string;
  name: string;
  /** script_characters.voice_preset. null 이면 자동. */
  voicePreset: string | null;
}

/**
 * 상대역마다 이번 회차에서 읽을 프리셋. 등장 순서(배열 순서)를 지킨다. 내 배역은 들지 않는다.
 * @returns Map<배역 id, 프리셋>
 */
export function assignPresets(characters: CastCharacter[], myCharacterIds: string[]): Map<string, VoicePreset> {
  const mine = new Set(myCharacterIds);
  const out = new Map<string, VoicePreset>();
  let auto = 0;
  for (const c of characters) {
    if (mine.has(c.id)) continue;
    if (isVoicePreset(c.voicePreset)) {
      out.set(c.id, c.voicePreset);
      continue;
    }
    out.set(c.id, PRESET_CYCLE[auto % PRESET_CYCLE.length]);
    auto++;
  }
  return out;
}

/**
 * 실행 화면이 배역 이름으로 찾는 목소리 표. 기기 음성용 말투는 상대역 순서로 돌려 쓴다(기존 방식).
 */
export function voicesFor(
  script: { characters: CastCharacter[] },
  myCharacterIds: string[],
): Record<string, RoleVoice> {
  const presets = assignPresets(script.characters, myCharacterIds);
  const partners = script.characters.filter((c) => presets.has(c.id));
  const device = assignVoices(partners.map((c) => c.name));
  const out: Record<string, RoleVoice> = {};
  for (const c of partners) out[c.name] = { device: device[c.name].device, preset: presets.get(c.id)! };
  return out;
}
