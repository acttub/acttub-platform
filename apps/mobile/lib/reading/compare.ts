import { latestRecordings } from './recording-plan.ts';
import type { SessionCard, SessionRecording } from './types.ts';

/**
 * 같은 대본 다시 읽기 비교(SOMA-863). 지난 회차와 이번 회차에서 둘 다 녹음이 남은 줄만 나란히 듣는다.
 * 달라진 점은 잴 수 있는 것(녹음 길이)만 말한다. 발음이 맞았는지·더 잘했는지는 판정하지 않는다.
 */

/** 이번 회차보다 먼저 시작해 녹음이 있는 가장 최근 회차. 없으면 null. */
export function previousRecordedSession(
  sessions: readonly Pick<SessionCard, 'id' | 'started_at' | 'recorded_line_count'>[],
  current: { id: string; started_at?: string | null },
): string | null {
  const before = current.started_at ? Date.parse(current.started_at) : Number.POSITIVE_INFINITY;
  let best: { id: string; at: number } | null = null;
  for (const s of sessions) {
    if (s.id === current.id || s.recorded_line_count <= 0) continue;
    const at = Date.parse(s.started_at);
    if (!Number.isFinite(at) || at >= before) continue;
    if (!best || at > best.at) best = { id: s.id, at };
  }
  return best?.id ?? null;
}

export type CompareRow = {
  lineId: string;
  previous: SessionRecording;
  current: SessionRecording;
};

/** 대본 순서대로, 두 회차 모두 들을 수 있는 녹음이 있는 줄만. 지워졌거나 없는 줄은 뺀다. */
export function compareRows(
  lineIds: readonly string[],
  previous: readonly SessionRecording[],
  current: readonly SessionRecording[],
): CompareRow[] {
  const prev = latestRecordings(previous.filter(playable));
  const cur = latestRecordings(current.filter(playable));
  const rows: CompareRow[] = [];
  for (const lineId of lineIds) {
    const p = prev.get(lineId);
    const c = cur.get(lineId);
    if (p && c) rows.push({ lineId, previous: p, current: c });
  }
  return rows;
}

function playable(rec: SessionRecording): boolean {
  return !!rec.playback_url && rec.duration_ms > 0;
}

export type LengthChange =
  | { kind: 'same'; previousSec: number; currentSec: number }
  | { kind: 'shorter' | 'longer'; previousSec: number; currentSec: number; diffSec: number };

/** 0.1초 단위. 차이가 0.3초 미만이거나 10% 미만이면 비슷하다고 본다(녹음 앞뒤 여백 흔들림). */
export function lengthChange(previousMs: number, currentMs: number): LengthChange {
  const previousSec = round1(previousMs / 1000);
  const currentSec = round1(currentMs / 1000);
  const diff = currentMs - previousMs;
  if (Math.abs(diff) < 300 || Math.abs(diff) < previousMs * 0.1) return { kind: 'same', previousSec, currentSec };
  return { kind: diff < 0 ? 'shorter' : 'longer', previousSec, currentSec, diffSec: round1(Math.abs(diff) / 1000) };
}

function round1(sec: number): number {
  return Math.round(sec * 10) / 10;
}
