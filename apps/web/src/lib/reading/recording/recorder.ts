/**
 * 내 차례 한 줄을 MediaRecorder 로 녹음한다. 내 차례에만 켜고 상대역 재생·일시정지 중에는 꺼진다(부르는 쪽).
 * 180초에 이르면 스스로 멈추고(줄은 그대로) 그때까지의 소리를 돌려준다.
 */
import { pickRecordingMimeType, RECORDING_MAX_MS } from "./limits";

export interface RecordedClip {
  blob: Blob;
  contentType: string;
  durationMs: number;
}

export interface LineRecorder {
  /** 멈추고 지금까지의 소리를 받는다. 아무것도 담기지 않았으면 null. */
  stop(): Promise<RecordedClip | null>;
  /** 버린다. 마이크도 놓는다. */
  cancel(): void;
}

export function recorderSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined" &&
    pickRecordingMimeType((t) => MediaRecorder.isTypeSupported(t)) !== null
  );
}

export async function startLineRecording(options: { maxMs?: number; onMaxReached?: () => void } = {}): Promise<LineRecorder> {
  const mimeType = pickRecordingMimeType((t) => MediaRecorder.isTypeSupported(t));
  if (!mimeType) throw new Error("이 브라우저는 녹음 형식을 지원하지 않아요.");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks: Blob[] = [];
  const startedAt = Date.now();
  let stoppedAt: number | null = null;
  let settled: ((clip: RecordedClip | null) => void) | null = null;
  const finished = new Promise<RecordedClip | null>((resolve) => {
    settled = resolve;
  });
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  recorder.onstop = () => {
    stream.getTracks().forEach((t) => t.stop());
    const durationMs = (stoppedAt ?? Date.now()) - startedAt;
    settled?.(chunks.length === 0 ? null : { blob: new Blob(chunks, { type: recorder.mimeType || mimeType }), contentType: recorder.mimeType || mimeType, durationMs });
  };
  recorder.start(1000);
  const maxMs = options.maxMs ?? RECORDING_MAX_MS;
  const limiter = setTimeout(() => {
    if (recorder.state === "recording") {
      stoppedAt = Date.now();
      recorder.stop();
      options.onMaxReached?.();
    }
  }, maxMs);

  return {
    stop() {
      clearTimeout(limiter);
      if (recorder.state === "recording") {
        stoppedAt = Date.now();
        recorder.stop();
      }
      return finished;
    },
    cancel() {
      clearTimeout(limiter);
      recorder.ondataavailable = null;
      chunks.length = 0;
      if (recorder.state === "recording") recorder.stop();
      else stream.getTracks().forEach((t) => t.stop());
    },
  };
}
