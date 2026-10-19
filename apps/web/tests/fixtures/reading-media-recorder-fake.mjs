// 브라우저 녹음 대역 — MediaRecorder 와 navigator.mediaDevices.getUserMedia. 테스트가 조각을 직접 내보내고,
// 마이크 요청과 놓은 트랙 수를 센다.
export class FakeMediaRecorder {
  static supported = new Set(["audio/webm;codecs=opus", "audio/webm"]);
  static instances = [];
  static isTypeSupported(type) {
    return FakeMediaRecorder.supported.has(type);
  }
  constructor(stream, options) {
    this.stream = stream;
    this.options = options;
    this.mimeType = options.mimeType;
    this.state = "inactive";
    this.ondataavailable = null;
    this.onstop = null;
    /** stop 때 마지막으로 내보낼 조각의 바이트 수 */
    this.tail = [];
    FakeMediaRecorder.instances.push(this);
  }
  start(timeslice) {
    this.timeslice = timeslice;
    this.state = "recording";
  }
  emit(bytes) {
    this.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)]) });
  }
  stop() {
    this.state = "inactive";
    queueMicrotask(() => {
      for (const bytes of this.tail.splice(0)) this.emit(bytes);
      this.onstop?.();
    });
  }
}

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");

/**
 * MediaRecorder 와 마이크를 심는다. getUserMedia 가 false 면 mediaDevices 에 getUserMedia 가 없다.
 * open 을 주면 마이크 요청마다 그 함수가 스트림(또는 거절)을 정한다.
 */
export function installRecorder({ getUserMedia = true, open } = {}) {
  const mic = { requests: [], stoppedTracks: 0 };
  const stream = () => ({ getTracks: () => [{ stop: () => mic.stoppedTracks++ }] });
  const mediaDevices = getUserMedia
    ? {
        getUserMedia: async (constraints) => {
          mic.requests.push(constraints);
          return open ? open(stream) : stream();
        },
      }
    : {};
  FakeMediaRecorder.instances = [];
  FakeMediaRecorder.supported = new Set(["audio/webm;codecs=opus", "audio/webm"]);
  globalThis.MediaRecorder = FakeMediaRecorder;
  Object.defineProperty(globalThis, "navigator", { value: { mediaDevices }, configurable: true, writable: true });
  return mic;
}

export function uninstallRecorder() {
  delete globalThis.MediaRecorder;
  if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
}
