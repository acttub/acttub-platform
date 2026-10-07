/**
 * 인식기 녹음 파일을 줄마다 따로 들고 있는다(reading.recording, SOMA-631). 인식기는 audioend 뒤에야 파일을 다
 * 쓰는데, 그걸 기다린 다음에 넘기면 자동 넘김이 느려진다. 그래서 내 차례가 끝나면 그 줄의 녹음을 떼어 내고
 * (detach) 곧바로 다음 줄로 넘긴다 — 떼어 낸 녹음은 뒤에서 audioend 를 기다린다. 다음 줄 듣기가 먼저 시작돼도
 * audioend 는 멈춘 순서대로 앞 줄 녹음에 붙는다.
 */
export const AUDIOEND_WAIT_MS = 1_500;

type Timers = {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: any) => void;
};

type Recording = { uri: string | null; ended: boolean; wake: (() => void) | null };

export type RecordingTracker = {
  /** 듣기 시작. persist 가 아니면 이 줄에는 녹음이 없다. */
  begin: (persist: boolean) => void;
  /** 인식기를 멈췄다 — 이 줄의 audioend 를 기다리는 줄에 세운다. */
  stopping: () => void;
  /** 인식기의 audioend. 멈춘 순서대로 가장 먼저 멈춘 줄의 녹음에 붙는다. */
  audioEnd: (uri: string | null | undefined) => void;
  /** 이 줄의 녹음을 떼어 낸다. audioend 가 오면(최대 AUDIOEND_WAIT_MS) 파일 uri, 없으면 null. */
  detach: () => Promise<string | null>;
  /** 끝나지 않고 닫힌 줄의 조각 파일(지울 것). 떼어 낸 녹음은 건드리지 않는다. */
  discard: () => string | null;
};

export function createRecordingTracker(timers: Timers = globalThis): RecordingTracker {
  let current: Recording | null = null;
  const ending: Recording[] = [];

  return {
    begin(persist) {
      current = persist ? { uri: null, ended: false, wake: null } : null;
    },
    stopping() {
      if (current && !current.ended && !ending.includes(current)) ending.push(current);
    },
    audioEnd(uri) {
      const rec = ending.shift() ?? current;
      if (!rec) return;
      if (uri) rec.uri = uri;
      rec.ended = true;
      rec.wake?.();
    },
    detach() {
      const rec = current;
      current = null;
      if (!rec) return Promise.resolve(null);
      if (rec.ended) return Promise.resolve(rec.uri);
      return new Promise((resolve) => {
        // 기다리다 놓아도 대기 줄에는 남긴다 — 늦게 온 audioend 가 다음 줄 녹음에 붙지 않게.
        const timer = timers.setTimeout(() => {
          rec.wake = null;
          resolve(rec.uri);
        }, AUDIOEND_WAIT_MS);
        rec.wake = () => {
          timers.clearTimeout(timer);
          rec.wake = null;
          resolve(rec.uri);
        };
      });
    },
    discard() {
      const rec = current;
      current = null;
      if (!rec) return null;
      const at = ending.indexOf(rec);
      if (at >= 0) ending.splice(at, 1);
      return rec.uri;
    },
  };
}
