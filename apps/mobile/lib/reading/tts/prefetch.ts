import { speechKey } from './speech-key.ts';

/**
 * 상대 대사를 미리 만들어 두는 큐 (SOMA-547).
 *
 * <p>음성 만들기는 폰 안에서 돈다. 대사 6초짜리가 4초쯤 걸리는데, 지금까지는 상대 차례가
 * <b>와서야</b> 만들기 시작해서 그 시간이 그대로 멈춤으로 보였다. 만드는 속도는 더 빠르게 할
 * 수 없다고 실기기에서 확인했으므로, 속도가 아니라 <b>순서</b>를 바꾼다 — 읽는 동안 다음 줄을
 * 미리 만들어 둔다.
 *
 * <p><b>한 번에 한 줄만 만든다.</b> 여럿을 동시에 만들면 CPU 를 나눠 가져 전부 느려지고,
 * 정작 지금 필요한 줄이 가장 늦게 나온다.
 *
 * <p>만드는 일과 파일 쓰기는 주입받는다 — 이 파일은 onnxruntime 없이도 시험할 수 있다.
 */

export type SpeechQueueOptions = {
  /** 한 줄을 만들어 파일로 남기고 그 자리를 돌려준다. */
  synthesize: (text: string, key: string) => Promise<string>;
  /** 어느 대본의 음성인가 — 파일 이름과 캐시를 가른다. */
  scriptId: string;
  locale: string;
  preset: string;
  variant: string;
  steps: number;
  speed: number;
};

export type SpeechQueue = {
  /** 앞으로 읽을 상대 대사를 순서대로 준다. 부를 때마다 남은 순서를 다시 잡는다. */
  prime: (texts: readonly string[]) => void;
  /**
   * 그 줄의 음성 자리. 이미 있으면 바로, 만드는 중이면 끝날 때까지 기다린다.
   * 아직 손도 안 댔거나 실패했으면 null — 부르는 쪽이 그때 직접 만든다.
   */
  take: (text: string) => Promise<string | null>;
  /** 화면을 나갈 때. 만들던 것이 끝나도 다음 줄로 넘어가지 않는다. */
  cancel: () => void;
  /** 시험용 — 지금 만들고 있는 한 줄이 끝날 때까지 기다린다(다음 줄은 그때 막 시작한다). */
  settled: () => Promise<void>;
};

export function createSpeechQueue(options: SpeechQueueOptions): SpeechQueue {
  const done = new Map<string, string>();
  const inFlight = new Map<string, Promise<string | null>>();
  let pending: string[] = [];
  let running: Promise<void> | null = null;
  let cancelled = false;

  const keyOf = (text: string) =>
    speechKey({
      text,
      locale: options.locale,
      preset: options.preset,
      variant: options.variant,
      steps: options.steps,
      speed: options.speed,
    });

  /** 만들 필요가 있는 줄만 남긴다 — 빈 줄과 이미 만든 줄은 뺀다. */
  const worth = (text: string) => {
    const clean = (text ?? '').trim();
    return clean.length > 0 && !done.has(keyOf(clean));
  };

  function pump(): void {
    if (running || cancelled) return;
    const next = pending.shift();
    if (next === undefined) return;
    if (!worth(next)) {
      pump();
      return;
    }
    running = makeOne(next.trim()).then(() => {
      running = null;
      // 만드는 동안 사용자가 건너뛰었을 수 있다 — 그 사이 다시 잡힌 순서를 따른다.
      if (!cancelled) pump();
    });
  }

  function makeOne(text: string): Promise<string | null> {
    const key = keyOf(text);
    const already = inFlight.get(key);
    if (already) return already;
    const work = options
      .synthesize(text, key)
      .then((uri) => {
        done.set(key, uri);
        return uri;
      })
      .catch(() => null) // 한 줄이 실패해도 큐는 멈추지 않는다 — 그 줄만 제때 못 쓴다.
      .finally(() => {
        inFlight.delete(key);
      });
    inFlight.set(key, work);
    return work;
  }

  return {
    prime(texts) {
      if (cancelled) return;
      pending = texts.filter(worth);
      pump();
    },
    async take(text) {
      const clean = (text ?? '').trim();
      if (!clean) return null;
      const key = keyOf(clean);
      const ready = done.get(key);
      if (ready) return ready;
      const making = inFlight.get(key);
      return making ? await making : null;
    },
    cancel() {
      cancelled = true;
      pending = [];
    },
    async settled() {
      // 지금 것만 기다린다. 끝나는 순간 다음 줄이 시작되므로, 전부 끝날 때까지 따라가면
      // 아직 아무도 만들어 주지 않은 줄에서 영영 못 빠져나온다.
      await running;
    },
  };
}
