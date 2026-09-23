/**
 * 회차 상세의 녹음 표시(reading.recording). "내 대사 N개 중 K개 녹음 · m:ss · P%", 줄 순서 재생 목록, 서명 주소
 * 만료 확인(만료 뒤에는 목록을 다시 조회해 새 주소를 받는다).
 */
import type { SessionCard, SessionRecording } from "@/lib/reading/api-types";
import type { ScriptLine } from "@/lib/reading/script/parse";

export function recordingSummary(card: Pick<SessionCard, "my_dialogue_count" | "recorded_line_count" | "elapsed_seconds">): string {
  const s = card.elapsed_seconds;
  const clock = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const percent = card.my_dialogue_count > 0 ? Math.round((card.recorded_line_count / card.my_dialogue_count) * 100) : 0;
  return `내 대사 ${card.my_dialogue_count}개 중 ${card.recorded_line_count}개 녹음 · ${clock} · ${percent}%`;
}

export interface PlaylistItem {
  lineId: string;
  role: string;
  text: string;
  recording: SessionRecording;
}

/** 이어 듣기 순서 — 대본의 줄 순서. 녹음이 없는 줄은 들지 않는다. */
export function playlistOf(script: { lines: ScriptLine[]; lineIds: string[] }, recordings: SessionRecording[]): PlaylistItem[] {
  const by = new Map(recordings.map((r) => [r.line_id, r]));
  const out: PlaylistItem[] = [];
  script.lines.forEach((l, i) => {
    const r = by.get(script.lineIds[i]);
    if (!r || l.type !== "dialogue") return;
    out.push({ lineId: script.lineIds[i], role: l.role, text: l.text, recording: r });
  });
  return out;
}

/** 아직 살아 있는 재생 주소. 만료됐거나 없으면 null — 부르는 쪽이 목록을 다시 받는다. */
export function playbackUrl(rec: Pick<SessionRecording, "playback_url" | "playback_expires_at">, now: Date = new Date()): string | null {
  if (!rec.playback_url || !rec.playback_expires_at) return null;
  const expires = new Date(rec.playback_expires_at).getTime();
  if (Number.isNaN(expires) || expires <= now.getTime()) return null;
  return rec.playback_url;
}

export function durationLabel(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
