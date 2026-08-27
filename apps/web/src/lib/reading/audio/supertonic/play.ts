/**
 * 합성된 소리를 재생한다. speechSynthesis 와 같은 약속을 지킨다 —
 * 다 읽으면 resolve, 중간에 끊기면 조용히 resolve(reject 하지 않는다).
 *
 * AudioContext 로 직접 버퍼를 울리다가 보통의 오디오 재생기로 바꿨다.
 * 버퍼 재생은 다른 작업이 CPU 를 물면 소리가 튄다 — 리허설 중에는 다음 대사를
 * 미리 합성하므로 그 상황이 실제로 생긴다. 오디오 재생기는 스스로 앞당겨 받아
 * 두므로 그런 부하에 훨씬 덜 흔들린다.
 */
import { writeWavFile } from "./helper.js";
import type { Synthesized } from "@/lib/reading/audio/supertonic/engine";

/** 재생기 하나를 계속 돌려 쓴다. 매번 새로 만들면 기기가 출력 장치를 다시 잡는다. */
let el: HTMLAudioElement | null = null;
let lastUrl: string | null = null;

/** 아무 소리도 없는 가장 짧은 wav — 첫 재생을 열어 두는 데만 쓴다. */
const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

function element(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (!el) {
    el = new Audio();
    el.preload = "auto";
  }
  return el;
}

/** iOS 는 사용자 제스처 안에서 한 번 재생해야 그 뒤 자동 재생이 된다. 버튼 핸들러에서 부른다. */
export function unlockAudio(): void {
  const a = element();
  if (!a) return;
  a.src = SILENT_WAV;
  void a.play().catch(() => {
    // 여기서 막히면 첫 대사에서 다시 시도된다.
  });
}

/**
 * 합성이 깨지면 진폭이 정상 범위를 한참 벗어난다. 그대로 재생하면 스피커로
 * 굉음이 나가므로 — 사람 귀가 먼저 다친다 — 내보내기 전에 막는다.
 * 정상 음성의 peak 는 1 이하다. 여유를 둬서 2 를 넘으면 깨진 것으로 본다.
 */
export function isSane(samples: ArrayLike<number>): boolean {
  if (samples.length === 0) return false;
  // 전체를 훑을 필요는 없다. 고르게 뽑아 봐도 깨진 신호는 바로 드러난다.
  const step = Math.max(1, Math.floor(samples.length / 4096));
  for (let i = 0; i < samples.length; i += step) {
    const x = samples[i];
    if (!Number.isFinite(x) || Math.abs(x) > 2) return false;
  }
  return true;
}

function release() {
  if (lastUrl) {
    URL.revokeObjectURL(lastUrl);
    lastUrl = null;
  }
}

export function playSynthesized(audio: Synthesized, signal?: AbortSignal): Promise<void> {
  const a = element();
  if (!a || signal?.aborted) return Promise.resolve();
  if (!isSane(audio.samples)) {
    console.error("[tts] 합성 결과가 정상 범위를 벗어나 재생하지 않는다.");
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    // 앞의 것이 아직 울리고 있으면 멈춘다. 두 대사가 겹치면 뭉개져 들린다.
    a.pause();
    release();

    const url = URL.createObjectURL(new Blob([writeWavFile(audio.samples, audio.sampleRate)], { type: "audio/wav" }));
    lastUrl = url;

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      signal?.removeEventListener("abort", onAbort);
      a.onended = null;
      a.onerror = null;
      resolve();
    };
    const onAbort = () => {
      a.pause();
      finish();
    };

    a.onended = finish;
    a.onerror = finish;
    signal?.addEventListener("abort", onAbort);

    a.src = url;
    void a.play().catch(finish);
  });
}
