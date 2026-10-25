/**
 * 예시 대본의 미리 만든 상대역 음성(reading.script 「예시 대본」). 서버 예시에서 복사한 대본이면 상대 대사를 서버가 미리
 * 만들어 둔 음성으로 읽는다 — 그 대본 하나 때문에 190MB 기기 목소리 모델을 받지 않게.
 *
 * `GET /v2/reading/scripts/{script_id}/example-audio` → `{example_id, voices: {배역 이름: 프리셋}, lines: [{line_id, url, duration_ms}]}`.
 * 예시가 아니면 404 `reading_example_audio_not_found`이고, 옛 서버(경로 없음)·끊김도 모두 「예시가 아님」(null)으로 본다.
 * `lines: []`는 상대 음성이 필요 없는 예시(독백)다. url 은 임시 주소라 연습을 시작할 때마다 새로 받는다(fresh).
 *
 * 이 파일은 순수 규칙만 둔다(받기는 주입). 파일 내려받기는 example-audio-runtime 이 한다.
 */

/** GET /v2/reading/scripts/{script_id}/example-audio 200 답. */
export type ExampleAudioResponse = {
  example_id: string;
  voices: Record<string, string>;
  lines: { line_id: string; url: string; duration_ms: number }[];
};

export type ExampleAudioLine = { url: string; durationMs: number };

export type ExampleAudio = {
  exampleId: string;
  /** 배역 이름 → 미리 만든 음성의 프리셋. */
  voices: Record<string, string>;
  /** 줄 id → 음성. 음성이 없는 줄은 빠져 있다. */
  lines: Map<string, ExampleAudioLine>;
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/** 서버 답 → 예시 음성. 모양이 틀리면 null(예시가 아닌 것과 같다). 틀린 줄·목소리 항목만 버린다. */
export function normalizeExampleAudio(body: unknown): ExampleAudio | null {
  if (!isRecord(body) || !nonEmpty(body.example_id) || !Array.isArray(body.lines)) return null;
  const voices: Record<string, string> = {};
  if (isRecord(body.voices)) {
    for (const [name, preset] of Object.entries(body.voices)) if (nonEmpty(preset)) voices[name] = preset;
  }
  const lines = new Map<string, ExampleAudioLine>();
  for (const item of body.lines) {
    if (!isRecord(item) || !nonEmpty(item.line_id) || !nonEmpty(item.url)) continue;
    const ms = item.duration_ms;
    lines.set(item.line_id, { url: item.url, durationMs: typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? ms : 0 });
  }
  return { exampleId: body.example_id, voices, lines };
}

/**
 * 이번 회차의 상대역 목소리(배역 이름 → 읽을 프리셋)가 모두 예시 음성의 목소리와 같은가. 배우가 목소리를 바꿨거나 예시에 없는
 * 배역이 있으면 미리 만든 음성은 다른 목소리라 쓰지 않는다.
 */
export function exampleVoicesMatch(audio: ExampleAudio | null, partnerPresets: Record<string, string>): boolean {
  if (!audio) return false;
  return Object.entries(partnerPresets).every(([name, preset]) => audio.voices[name] === preset);
}

type Fetcher = (scriptId: string) => Promise<unknown> | unknown;
type Entry = { at: number; value: ExampleAudio | null };

/** 임시 주소가 살아 있을 동안만 기억한다(음성 모델 주소처럼 길지 않다고 본다). */
const DEFAULT_MAX_AGE_MS = 10 * 60 * 1000;

export type ExampleAudioLoader = {
  /** 이 대본의 예시 음성. 예시가 아니거나 못 받으면 null. fresh 면 기억을 버리고 새로 받는다(연습 시작). */
  load: (scriptId: string, options?: { fresh?: boolean }) => Promise<ExampleAudio | null>;
  /** 기억한 값(아직 모르면 undefined). */
  cached: (scriptId: string) => ExampleAudio | null | undefined;
  clear: () => void;
};

export function createExampleAudioLoader(fetcher: Fetcher, options: { maxAgeMs?: number; now?: () => number } = {}): ExampleAudioLoader {
  const maxAge = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const now = options.now ?? Date.now;
  const memo = new Map<string, Entry>();
  const inFlight = new Map<string, Promise<ExampleAudio | null>>();

  const fresh = (entry: Entry | undefined) => (entry && now() - entry.at <= maxAge ? entry : undefined);

  return {
    load(scriptId, opts = {}) {
      if (!opts.fresh) {
        const hit = fresh(memo.get(scriptId));
        if (hit) return Promise.resolve(hit.value);
        const making = inFlight.get(scriptId);
        if (making) return making;
      }
      const work = Promise.resolve()
        .then(() => fetcher(scriptId))
        .then(normalizeExampleAudio, () => null)
        .then((value) => {
          memo.set(scriptId, { at: now(), value });
          return value;
        })
        .finally(() => {
          if (inFlight.get(scriptId) === work) inFlight.delete(scriptId);
        });
      inFlight.set(scriptId, work);
      return work;
    },
    cached(scriptId) {
      return fresh(memo.get(scriptId))?.value;
    },
    clear() {
      memo.clear();
      inFlight.clear();
    },
  };
}

function safe(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '');
}

/** 짧은 해시(djb2) — 서버가 음성을 새로 만들면(경로가 바뀌면) 다른 파일이 되게. */
function shortHash(value: string): string {
  let h = 5381;
  for (let i = 0; i < value.length; i++) h = ((h << 5) + h + value.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|opus)$/i;

/** 캐시 폴더에 둘 예시 음성 파일 이름. 서명(쿼리)은 매번 달라 경로만 본다. */
export function exampleAudioFileName(exampleId: string, lineId: string, url: string): string {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {}
  const ext = (AUDIO_EXT.exec(path)?.[1] ?? 'mp3').toLowerCase();
  return `reading-example-${safe(exampleId)}-${safe(lineId)}-${shortHash(path)}.${ext}`;
}
