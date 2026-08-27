/**
 * 마이크 → RMS 수치만 뽑아 침묵 감지기에 넣는다. 오디오는 녹음·전송하지 않는다.
 */
import { createSilenceDetector, rmsOf, type VadEvent, type VadOptions } from "@/lib/reading/audio/vad";

export interface MicListener {
  stop(): void;
}

export interface MicCallbacks {
  onEvent: (event: VadEvent) => void;
  /** 0~1 음량. 화면 미터용 */
  onLevel?: (rms: number) => void;
}

const TICK_MS = 50;

export function micSupported(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

export async function startListening(opts: VadOptions, cb: MicCallbacks): Promise<MicListener> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: false,
  });
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  const detector = createSilenceDetector(opts, performance.now());

  let stopped = false;
  const timer = setInterval(() => {
    if (stopped) return;
    analyser.getFloatTimeDomainData(buf);
    const rms = rmsOf(buf);
    cb.onLevel?.(rms);
    const ev = detector.feed(rms, performance.now());
    if (ev !== "none") cb.onEvent(ev);
  }, TICK_MS);

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      // 화면은 멈췄는데 마이크가 켜진 채로 두지 않는다
      stream.getTracks().forEach((t) => t.stop());
      source.disconnect();
      void ctx.close();
    },
  };
}
