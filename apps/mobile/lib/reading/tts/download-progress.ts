/**
 * 상대역 목소리 모델 다운로드의 전체 진행률과 남은 시간 (SOMA-494).
 *
 * 파일마다 따로 오는 진행 보고를 한 줄(받은 양 / 전체 · 남은 시간)로 합친다. 네이티브 없이 시험할 수 있게
 * 시계와 번역 함수는 주입받는다.
 *
 * 속도는 최근 구간(windowMs)의 이동 평균이다. 캐시로 이미 있던 파일과, 이어받기의 첫 보고(이미 받아 둔
 * 바이트가 한꺼번에 들어온다)는 속도에 넣지 않는다 — 넣으면 처음 몇 초가 수백 MB/s 로 보인다.
 */

export type DownloadFile = { id: string; bytes: number };

export type DownloadSnapshot = {
  receivedBytes: number;
  totalBytes: number;
  /** 0~100 내림 */
  percent: number;
  /** 모르면 null */
  etaSeconds: number | null;
};

/** 엔진이 화면에 알리는 준비 단계. */
export type VoiceProgress = ({ phase: 'download' } & DownloadSnapshot) | { phase: 'load' } | { phase: 'ready' };

export type DownloadProgress = {
  /** 이 파일을 지금까지 받은 바이트(이어받기면 앞부분 포함). */
  update: (id: string, receivedBytes: number) => void;
  /** 이미 받아 둔 파일 — 완료로 치되 속도에는 넣지 않는다. */
  complete: (id: string) => void;
  /** 조각을 버리고 처음부터 다시 받을 때. */
  reset: (id: string) => void;
  snapshot: () => DownloadSnapshot;
};

const MIN_SPAN_MS = 1000;

export function createDownloadProgress(
  files: readonly DownloadFile[],
  options: { now?: () => number; windowMs?: number } = {},
): DownloadProgress {
  const now = options.now ?? Date.now;
  const windowMs = options.windowMs ?? 8000;
  const sizes = new Map(files.map((f) => [f.id, Math.max(0, f.bytes)]));
  const received = new Map<string, number>();
  /** 첫 보고를 받은 파일 — 그 전의 첫 보고는 기준점일 뿐 속도로 치지 않는다. */
  const seen = new Set<string>();
  /** 이번에 실제로 네트워크로 받은 누적 바이트. */
  let transferred = 0;
  let samples: { t: number; bytes: number }[] = [];

  const totalBytes = [...sizes.values()].reduce((a, b) => a + b, 0);

  function sample() {
    const t = now();
    samples.push({ t, bytes: transferred });
    // 창 밖 표본은 버린다. 방금 넣은 표본은 항상 창 안이다.
    const from = t - windowMs;
    samples = samples.filter((s) => s.t >= from);
  }

  return {
    update(id, bytes) {
      const size = sizes.get(id);
      if (size === undefined) return;
      const next = Math.min(size, Math.max(0, bytes));
      const prev = received.get(id) ?? 0;
      if (seen.has(id) && next > prev) transferred += next - prev;
      seen.add(id);
      received.set(id, next);
      sample();
    },
    complete(id) {
      const size = sizes.get(id);
      if (size === undefined) return;
      received.set(id, size);
      seen.add(id);
    },
    reset(id) {
      if (!sizes.has(id)) return;
      received.set(id, 0);
      seen.delete(id);
    },
    snapshot() {
      const got = [...received.values()].reduce((a, b) => a + b, 0);
      const remaining = Math.max(0, totalBytes - got);
      let etaSeconds: number | null = null;
      if (remaining === 0) etaSeconds = 0;
      else if (samples.length >= 2) {
        const first = samples[0];
        const last = samples[samples.length - 1];
        const span = last.t - first.t;
        const speed = span >= MIN_SPAN_MS ? (last.bytes - first.bytes) / (span / 1000) : 0;
        if (speed > 0) etaSeconds = Math.ceil(remaining / speed);
      }
      return {
        receivedBytes: got,
        totalBytes,
        percent: totalBytes > 0 ? Math.floor((got / totalBytes) * 100) : 0,
        etaSeconds,
      };
    },
  };
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

const MB = 1024 * 1024;

/** "142 / 380MB · 약 2분 남음". 받은 양은 내림이라 끝나기 전에는 전체와 같아 보이지 않는다. */
export function formatDownloadProgress(s: DownloadSnapshot, tr: Translate): string {
  const size = `${Math.floor(s.receivedBytes / MB)} / ${Math.round(s.totalBytes / MB)}MB`;
  if (s.etaSeconds === null || s.receivedBytes >= s.totalBytes) return size;
  const eta =
    s.etaSeconds < 60 ? tr('reading.downloadEtaSoon') : tr('reading.downloadEtaMinutes', { count: Math.ceil(s.etaSeconds / 60) });
  return `${size} · ${eta}`;
}
