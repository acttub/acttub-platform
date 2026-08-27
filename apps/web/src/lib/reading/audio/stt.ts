/**
 * 브라우저 음성인식(SpeechRecognition) 래퍼 — 암기 대조 전용.
 * ⚠ 말소리가 브라우저 벤더 서버로 간다. 화면에서 그 사실을 알린다.
 * 결과 텍스트는 맞춰보기에 쓰고 즉시 버린다 — 저장하지 않는다.
 *
 * 인앱 브라우저(iOS WKWebView)는 객체만 있고 동작하지 않으므로
 * 기능 감지가 아니라 실제 start()와 타임아웃으로 맞춰보기한다.
 */

type RecognitionCtor = new () => SpeechRecognitionLike;
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }> }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

function ctor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function sttAvailable(): boolean {
  return ctor() !== null;
}

const squash = (s: string) => s.replace(/\s+/g, "");

/**
 * 인식 결과 항목들을 한 문장으로 합친다.
 *
 * 데스크톱 크롬은 항목이 이어지는 조각("너 맨날", "그러잖아")이라 붙이면 되지만,
 * 안드로이드 크롬은 확정·중간 가리지 않고 항목마다 처음부터의 누적("너", "너 맨날",
 * "너 맨날 그러잖아")을 준다. 이걸 붙이면 "너 너맨날 너맨날그러잖아"가 된다.
 *
 * 그래서 항목을 차례로 보며, 지금까지 합친 것이 새 항목의 앞부분이면 새 항목으로 갈아 끼우고
 * (누적), 새 항목이 지금까지 것의 앞부분이면 버리고, 둘 다 아니면 이어 붙인다(조각).
 * 띄어쓰기는 항목마다 달라질 수 있어 비교할 때만 뺀다.
 */
export function mergeTranscripts(parts: string[]): string {
  let acc = "";
  for (const raw of parts) {
    const t = raw.trim();
    if (!t) continue;
    const a = squash(acc);
    const b = squash(t);
    if (!a || b.startsWith(a)) acc = t;
    else if (a.startsWith(b)) continue;
    else acc = `${acc} ${t}`;
  }
  return acc.trim();
}

export interface Listening {
  /** 멈추고 지금까지 인식된 텍스트를 받는다 */
  stop(): void;
  abort(): void;
}

export interface SttCallbacks {
  onStart?: () => void;
  /** 인식되는 대로. 말이 이어지는지 보는 데 쓴다 */
  onInterim?: (text: string) => void;
  onText: (text: string) => void;
  onError: (reason: "unavailable" | "denied" | "no-speech" | "failed") => void;
}

const START_TIMEOUT_MS = 2500;

export function startRecognition(cb: SttCallbacks, continuous = true): Listening {
  const C = ctor();
  if (!C) {
    cb.onError("unavailable");
    return { stop() {}, abort() {} };
  }
  const r = new C();
  r.lang = "ko-KR";
  r.interimResults = true;
  // 우리가 말 끝을 판단할 때는 계속 듣고, 브라우저에 맡길 때는 스스로 끊게 둔다.
  r.continuous = continuous;
  r.maxAlternatives = 1;
  let text = "";
  let started = false;
  let finished = false;
  const timer = setTimeout(() => {
    if (!started && !finished) {
      finished = true;
      try {
        r.abort();
      } catch {}
      cb.onError("unavailable");
    }
  }, START_TIMEOUT_MS);
  r.onstart = () => {
    started = true;
    clearTimeout(timer);
    cb.onStart?.();
  };
  r.onresult = (e) => {
    const parts: string[] = [];
    for (let i = 0; i < e.results.length; i++) {
      const t = e.results[i][0].transcript.trim();
      if (t) parts.push(t);
    }
    const s = mergeTranscripts(parts);
    text = s;
    cb.onInterim?.(s);
  };
  r.onerror = (e) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    const reason = e.error === "not-allowed" || e.error === "service-not-allowed" ? "denied" : e.error === "no-speech" ? "no-speech" : "failed";
    cb.onError(reason);
  };
  r.onend = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    cb.onText(text.trim());
    text = "";
  };
  try {
    r.start();
  } catch {
    finished = true;
    clearTimeout(timer);
    cb.onError("failed");
  }
  return {
    stop() {
      try {
        r.stop();
      } catch {}
    },
    abort() {
      finished = true;
      clearTimeout(timer);
      try {
        r.abort();
      } catch {}
    },
  };
}


// ─── 말이 끝나면 알아서 맞춰보기하기 ──────────────────────────────────

export interface AutoListening {
  /** 다 말했는데 기다리기 싫을 때 — 지금까지 말한 것으로 확정한다 */
  finish(): void;
  abort(): void;
}

export interface AutoSttCallbacks {
  onListening?: () => void;
  /** 인식되는 대로 화면에 보여 주기 위한 것 */
  onInterim?: (text: string) => void;
  onText: (text: string) => void;
  onError: (reason: "unavailable" | "denied" | "no-speech" | "failed") => void;
}

/** 테스트에서 인식기를 갈아 끼우기 위한 자리. */
export interface AutoDeps {
  startRec: (cb: SttCallbacks, continuous: boolean) => Listening;
}

const REAL_DEPS: AutoDeps = { startRec: startRecognition };

export interface AutoOptions {
  /** 인식 결과가 이만큼 안 바뀌면 말이 끝난 것으로 본다 */
  silenceMs?: number;
  /** 한 마디도 못 알아들은 채 이만큼 지나면 포기한다 */
  maxListenMs?: number;
}

/**
 * 누르고 있지 않아도 된다 — 말이 끝나면 알아서 맞춰본다.
 *
 * 말 끝은 **인식 결과가 더 이상 늘지 않는 것**으로 본다.
 * 마이크를 여는 곳이 인식기 하나뿐이라, 음량을 따로 재려고 getUserMedia 로
 * 스트림을 하나 더 열 필요가 없다. 기기에 따라 두 곳이 마이크를 다투는 일이
 * 생길 수 있는데, 애초에 하나만 쓰면 그런 경우가 없다.
 *
 * 브라우저 인식기에 끊는 것까지 맡기지는 않는다 — 크롬은 5초쯤 조용하면 스스로
 * 세션을 닫아 대사 중간의 호흡에서 잘린다. 끊는 시점은 우리가 정한다.
 */
export function startAutoRecognition(
  cb: AutoSttCallbacks,
  deps: AutoDeps = REAL_DEPS,
  opts: AutoOptions = {},
): AutoListening {
  const silenceMs = opts.silenceMs ?? 1800;
  const maxListenMs = opts.maxListenMs ?? 60000;

  let rec: Listening | null = null;
  let done = false;
  /** 인식기를 다시 열면 결과가 초기화되므로 우리가 이어 붙인다 */
  let carried = "";
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;

  const clearSilence = () => {
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = null;
  };

  const overall = setTimeout(() => {
    if (done) return;
    // 여기까지 왔는데 아무것도 못 알아들었다면 더 기다릴 이유가 없다.
    if (carried.trim()) rec?.stop();
    else settleError("no-speech");
  }, maxListenMs);

  const cleanup = () => {
    clearSilence();
    clearTimeout(overall);
  };

  function settleText(text: string) {
    if (done) return;
    done = true;
    cleanup();
    const t = `${carried} ${text}`.trim();
    // 빈 결과를 성공으로 넘기면 대사를 말하지 않았는데 통과한 것이 된다.
    if (t) cb.onText(t);
    else cb.onError("no-speech");
  }

  function settleError(reason: Parameters<AutoSttCallbacks["onError"]>[0]) {
    if (done) return;
    done = true;
    cleanup();
    cb.onError(reason);
  }

  const openRec = (first: boolean) => {
    let session = "";
    rec = deps.startRec(
      {
        onStart: () => {
          if (!done && first) cb.onListening?.();
        },
        onInterim: (t) => {
          if (done) return;
          session = t;
          cb.onInterim?.(`${carried} ${t}`.trim());
          // 말이 이어지는 동안에는 끝을 미룬다.
          clearSilence();
          silenceTimer = setTimeout(() => rec?.stop(), silenceMs);
        },
        onText: settleText,
        onError: (reason) => {
          if (done) return;
          if (reason === "no-speech") {
            // 크롬이 조급하게 닫은 것뿐이다. 여태 들은 것을 안고 다시 연다.
            carried = `${carried} ${session}`.trim();
            clearSilence();
            openRec(false);
            return;
          }
          settleError(reason);
        },
      },
      true,
    );
  };

  openRec(true);

  return {
    finish() {
      rec?.stop();
    },
    abort() {
      done = true;
      cleanup();
      rec?.abort();
      rec = null;
    },
  };
}
