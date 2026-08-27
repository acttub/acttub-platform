/**
 * 상대 대사를 소리로 내보내는 곳. 두 가지 엔진이 있다.
 *
 *  supertonic — 브라우저 안에서 도는 신경망 음성. 기본이고, 훨씬 자연스럽다.
 *  device     — 기기 내장 speechSynthesis. 모델을 받기 전이거나 받을 수 없을 때 쓴다.
 *
 * 둘 다 대본을 밖으로 보내지 않는다 — 단, 기기에 원격 음성밖에 없으면
 * speechSynthesis 는 텍스트를 브라우저 음성 서비스로 넘긴다. `isRemoteOnly()` 로 알린다.
 */
import { speakableText } from "@/lib/reading/script/parse";
import { synthesize, load as loadSupertonic } from "@/lib/reading/audio/supertonic/engine";
import { playSynthesized, unlockAudio } from "@/lib/reading/audio/supertonic/play";
import { VOICE_PRESETS, type VoicePreset } from "@/lib/reading/audio/supertonic/models";

export type Engine = "supertonic" | "device";

/** 기기 내장 음성의 말투. 엔진이 포먼트를 보정하지 못하므로 크게 흔들지 않는다. */
export interface VoiceStyle {
  pitch: number;
}

/** 배역 하나에 배정된 목소리. 엔진이 바뀌어도 같은 배역은 같은 목소리로 들려야 한다. */
export interface RoleVoice {
  device: VoiceStyle;
  preset: VoicePreset;
}

/**
 * 기기 음성용 말투 팔레트.
 *
 * 예전에는 pitch 를 0.65~1.5 까지 벌렸는데, 배역은 구분됐지만 사람 목소리에서
 * 멀어졌다. 이제 배역 구분은 Supertonic 프리셋이 맡으므로 여기서는 좁게 둔다.
 */
const DEVICE_STYLES: VoiceStyle[] = [
  { pitch: 1.0 },
  { pitch: 1.12 },
  { pitch: 0.9 },
  { pitch: 1.06 },
  { pitch: 0.95 },
];

/** 남녀가 번갈아 나오도록 섞어 둔다 — 등장 순서대로 집으면 대개 대화처럼 들린다. */
const PRESET_ORDER: VoicePreset[] = ["F1", "M1", "F2", "M2", "F3", "M3", "F4", "M4", "F5", "M5"];

/**
 * 배역 목록을 받아 배역마다 목소리를 정한다.
 * 순서만 보고 정하므로, 같은 대본이면 다시 들어와도 같은 목소리가 나온다.
 */
export function assignVoices(roles: string[]): Record<string, RoleVoice> {
  const out: Record<string, RoleVoice> = {};
  roles.forEach((role, i) => {
    out[role] = {
      device: DEVICE_STYLES[i % DEVICE_STYLES.length],
      preset: PRESET_ORDER[i % PRESET_ORDER.length],
    };
  });
  return out;
}

/** SpeechSynthesisVoice 중 우리가 보는 부분만. 테스트에서 만들어 넣기 위해 좁혀 뒀다. */
export interface VoiceLike {
  name: string;
  lang: string;
  localService: boolean;
}

/**
 * 한국어 음성을 품질 순으로 정렬한다.
 *
 * 예전에는 localService 를 우선했는데, 윈도우의 유일한 한국어 로컬 음성이
 * 구형 SAPI5 인 Heami 라서 항상 가장 나쁜 것을 골랐다. 이제는 이름으로 판별한다 —
 * Natural/Neural 계열이 가장 낫고, Heami 는 다른 선택지가 있으면 뒤로 민다.
 */
export function rankKoreanVoices<T extends VoiceLike>(voices: T[]): T[] {
  const weight = (v: T): number => {
    const n = v.name.toLowerCase();
    if (/heami/.test(n)) return 0;
    if (/natural|neural/.test(n)) return 4;
    if (/google/.test(n)) return 3;
    return 2;
  };
  return voices
    .filter((v) => v.lang && v.lang.toLowerCase().split(/[-_]/)[0] === "ko")
    .map((v, i) => ({ v, i, s: weight(v) }))
    // 무게가 같으면 기기 안에서 도는 쪽이 낫다 — 오프라인이고 대본이 나가지 않는다.
    .sort((a, b) => b.s - a.s || Number(b.v.localService) - Number(a.v.localService) || a.i - b.i)
    .map((x) => x.v);
}

// ─── 기기 내장 음성 ────────────────────────────────────────────────

export function ttsSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

export function getKoreanVoices(): SpeechSynthesisVoice[] {
  if (!ttsSupported()) return [];
  return rankKoreanVoices(window.speechSynthesis.getVoices() as unknown as VoiceLike[]) as unknown as SpeechSynthesisVoice[];
}

/** 한국어 음성이 있는데 전부 원격이면 true — 화면에서 알려 준다 */
export function isRemoteOnly(): boolean {
  const voices = getKoreanVoices();
  return voices.length > 0 && voices.every((v) => !v.localService);
}

/** Chrome은 getVoices()가 처음엔 빈 배열이라 voiceschanged를 기다린다 */
export function waitForVoices(timeoutMs = 1500): Promise<SpeechSynthesisVoice[]> {
  if (!ttsSupported()) return Promise.resolve([]);
  const now = getKoreanVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => {
      window.speechSynthesis.removeEventListener("voiceschanged", done);
      resolve(getKoreanVoices());
    };
    window.speechSynthesis.addEventListener("voiceschanged", done);
    setTimeout(done, timeoutMs);
  });
}

function speakWithDevice(body: string, style: VoiceStyle, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    const u = new SpeechSynthesisUtterance(body);
    const voice = getKoreanVoices()[0];
    if (voice) u.voice = voice;
    u.lang = "ko-KR";
    u.pitch = style.pitch;

    let finished = false;
    let ping: ReturnType<typeof setInterval> | null = null;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (ping) clearInterval(ping);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    const onAbort = () => {
      synth.cancel();
      finish();
    };
    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort);

    u.onend = finish;
    u.onerror = finish;
    synth.cancel();
    synth.speak(u);
    // Chrome은 15초 넘는 발화를 조용히 끊으므로 pause/resume 핑을 돈다.
    ping = setInterval(() => {
      if (!synth.speaking) return;
      synth.pause();
      synth.resume();
    }, 10000);
  });
}

// ─── 엔진 선택 ────────────────────────────────────────────────────

let engine: Engine = "device";
let playing: AbortController | null = null;

export function getEngine(): Engine {
  return engine;
}

export function setEngine(next: Engine): void {
  if (next === engine) return;
  cancelSpeech();
  engine = next;
}

/**
 * Supertonic 을 켠다. 모델을 받고 한 번 데워 둔다 —
 * WebGPU 는 첫 합성에서 셰이더를 컴파일하느라 3초 넘게 걸린다.
 */
export async function enableSupertonic(onProgress?: Parameters<typeof loadSupertonic>[0]): Promise<void> {
  // 워커가 모델을 연 직후에 스스로 한 번 데우므로 여기서 따로 하지 않는다.
  await loadSupertonic(onProgress);
  engine = "supertonic";
}

/** iOS 는 사용자 제스처 안에서 한 번 소리를 내야 그 뒤 자동 재생이 된다. 버튼 핸들러에서 부른다. */
export function unlockTts(): void {
  unlockAudio();
  if (!ttsSupported()) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(" ");
  u.volume = 0;
  window.speechSynthesis.speak(u);
}

export function cancelSpeech(): void {
  playing?.abort();
  playing = null;
  if (ttsSupported()) window.speechSynthesis.cancel();
}

/**
 * 한 대사를 읽고 끝나면 resolve. signal 이 abort 되면 즉시 멈추고 조용히 resolve 한다.
 * Supertonic 이 실패하면 그 자리에서 기기 음성으로 읽는다 — 리허설이 멈추면 안 된다.
 */
export async function speak(text: string, voice: RoleVoice, signal?: AbortSignal): Promise<void> {
  const body = speakableText(text);
  if (!body) return;

  if (engine === "supertonic") {
    try {
      const audio = await synthesize(body, voice.preset);
      if (signal?.aborted) return;
      const ac = new AbortController();
      playing = ac;
      signal?.addEventListener("abort", () => ac.abort());
      await playSynthesized(audio, ac.signal);
      return;
    } catch {
      // 아래 기기 음성으로 떨어진다.
    }
  }

  if (!ttsSupported()) return;
  return speakWithDevice(body, voice.device, signal);
}

/** 다음에 나올 대사를 미리 만들어 둔다. 내 차례일 때 불러 두면 상대 대사가 곧바로 나온다. */
export async function prefetch(text: string, voice: RoleVoice): Promise<void> {
  if (engine !== "supertonic") return;
  const body = speakableText(text);
  if (!body) return;
  await synthesize(body, voice.preset).catch(() => {
    // 미리 만들어 두는 것뿐이라 실패해도 그냥 넘어간다.
  });
}

// ─── 앞으로 나올 대사를 순서대로 미리 만들어 두는 큐 ───────────────────────
//
// 느린 기기(WebGPU 없는 폰)는 합성이 재생보다 오래 걸린다(RTF > 1). 한 줄만 미리 만들면
// 내 차례가 짧을 때 따라잡지 못해 상대 대사 앞에 침묵이 생긴다. 그래서 앞의 몇 줄을
// 한 번에 하나씩 순서대로 만들어 둔다. 한 번에 하나만 돌리므로 지금 당장 필요한 줄의
// 합성은 길어야 한 줄만 기다린다. 만든 결과는 엔진 캐시에 남는다.

interface PrefetchItem {
  text: string;
  voice: RoleVoice;
}

let prefetchQueue: PrefetchItem[] = [];
let prefetchRunning = false;
let prefetchPaused = false;

async function runPrefetch(): Promise<void> {
  if (prefetchRunning) return;
  prefetchRunning = true;
  try {
    while (prefetchQueue.length > 0 && !prefetchPaused && engine === "supertonic") {
      const item = prefetchQueue.shift()!;
      const body = speakableText(item.text);
      if (!body) continue;
      await synthesize(body, item.voice.preset).catch(() => {
        // 미리 만드는 것뿐이라 실패는 넘어간다. speak 이 다시 시도한다.
      });
    }
  } finally {
    prefetchRunning = false;
  }
}

/** 앞으로 나올 상대 대사들을 순서대로 등록한다. 이미 만든 것은 캐시가 바로 돌려주므로 비용이 없다. */
export function queuePrefetch(items: PrefetchItem[]): void {
  if (engine !== "supertonic") return;
  prefetchQueue = items.slice();
  void runPrefetch();
}

/** 상대가 읽는 동안에는 멈춘다 — 합성과 재생이 자원을 다투면 소리가 끊긴다. */
export function setPrefetchPaused(paused: boolean): void {
  prefetchPaused = paused;
  if (!paused) void runPrefetch();
}

export function clearPrefetch(): void {
  prefetchQueue = [];
}

export { VOICE_PRESETS, type VoicePreset };
