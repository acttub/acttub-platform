/**
 * 상대 대사를 어느 목소리로 낼지(reading.cast · reading.session).
 *
 * 앱 목소리(Supertonic, 약 380MB 모델)를 못 쓰는 기기는 기기 저장소에 표시해 두고 다시 받지 않는다 — 불러오기에
 * 실패했거나(model_load), 불러오기 시작 표시만 있고 끝 표시 없이 앱이 다시 켜졌으면(꺼진 것으로 본다) 표시한다.
 * 그런 기기에서는 묻지 않고 ①고품질 목소리(서버) → ②기기 기본 목소리 → ③글로 보기 순으로 자동이고, ②·③으로
 * 가는 첫 회차에만 안내 화면(R9.7)을 한 번 보인다.
 *
 * 한계: 내려받기 전에 메모리(Device.totalMemory)로 거르지 않는다 — 기준값을 저사양 기기에서 재지 않았다.
 * 재서 정하면 readAppVoiceSupport 가 표시를 읽기 전에 기준 아래를 unsupported 로 돌려주면 된다.
 */
export const APP_VOICE_UNSUPPORTED_KEY = 'acttub.reading.appVoiceUnsupported';
export const MODEL_LOAD_STARTED_KEY = 'acttub.reading.modelLoadStarted';

type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

function defaultStorage(): Storage {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@react-native-async-storage/async-storage').default as Storage;
}

export type AppVoiceSupport = { unsupported: false } | { unsupported: true; noticed: boolean };

/** 표시를 읽는다. 끝 표시 없이 남은 불러오기 시작 표시는 여기서 "못 씀"으로 굳힌다. 못 읽으면 쓸 수 있는 것으로 본다. */
export async function readAppVoiceSupport(storage: Storage = defaultStorage()): Promise<AppVoiceSupport> {
  try {
    const flag = await storage.getItem(APP_VOICE_UNSUPPORTED_KEY);
    if (flag) return { unsupported: true, noticed: flag === 'noticed' };
    if (await storage.getItem(MODEL_LOAD_STARTED_KEY)) {
      await storage.setItem(APP_VOICE_UNSUPPORTED_KEY, '1');
      await storage.removeItem(MODEL_LOAD_STARTED_KEY);
      return { unsupported: true, noticed: false };
    }
  } catch {
    // no-op
  }
  return { unsupported: false };
}

export async function markModelLoadStarted(storage: Storage = defaultStorage()): Promise<void> {
  try {
    await storage.setItem(MODEL_LOAD_STARTED_KEY, '1');
  } catch {
    // no-op
  }
}

export async function markModelLoadEnded(storage: Storage = defaultStorage()): Promise<void> {
  try {
    await storage.removeItem(MODEL_LOAD_STARTED_KEY);
  } catch {
    // no-op
  }
}

export async function markAppVoiceUnsupported(storage: Storage = defaultStorage()): Promise<void> {
  try {
    await storage.setItem(APP_VOICE_UNSUPPORTED_KEY, '1');
    await storage.removeItem(MODEL_LOAD_STARTED_KEY);
  } catch {
    // no-op
  }
}

export async function markAppVoiceNoticed(storage: Storage = defaultStorage()): Promise<void> {
  try {
    await storage.setItem(APP_VOICE_UNSUPPORTED_KEY, 'noticed');
  } catch {
    // no-op
  }
}

/** 상대 대사를 내는 방식. cloud 는 서버 고품질 목소리, supertonic 은 기기에 받은 앱 목소리, device_voice 는 OS 음성. */
export type PartnerVoiceEngine = 'supertonic' | 'cloud' | 'device_voice' | 'text_only';

/** 쓸 수 있는 것 가운데 가장 좋은 것. appVoice 는 모델을 쓸 수 있고(기기가 되고) 받기로 한 경우만 true. */
export function choosePartnerVoice(input: { cloud: boolean; appVoice: boolean; deviceVoice: boolean }): PartnerVoiceEngine {
  if (input.cloud) return 'cloud';
  if (input.appVoice) return 'supertonic';
  return input.deviceVoice ? 'device_voice' : 'text_only';
}

/**
 * 기기에 그 말의 음성이 있는가. 말 코드는 첫 조각(ko·en)만 맞춘다(ko-KR·ko_KR 모두 한국어).
 * 목록이 비어 있으면 있는 것으로 본다 — 안드로이드는 음성 엔진이 뜨기 전에 빈 목록을 주는데 그때도 Speech.speak 는 된다.
 */
export function voiceSupportsLocale(voices: { language: string }[], locale: string): boolean {
  if (voices.length === 0) return true;
  const want = locale.split(/[-_]/)[0].toLowerCase();
  return voices.some((v) => (v.language ?? '').split(/[-_]/)[0].toLowerCase() === want);
}
