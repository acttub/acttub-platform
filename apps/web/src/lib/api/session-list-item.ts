import type { CoachSessionDto, PracticeSessionListItemDto } from "./types";

const bounded = (value: string, maximum: number): string =>
  Array.from(value).slice(0, maximum).join("");

const titleValue = (value: string | null | undefined, fallback: string): string =>
  bounded(value?.trim() || fallback, 120);

const previewValue = (value: string | null | undefined): string | null => {
  const normalized = value?.trim();
  return normalized ? bounded(normalized, 240) : null;
};

export function toPracticeSessionListItem(session: CoachSessionDto): PracticeSessionListItemDto {
  if (session.legacy) return {
    id: session.id,
    pipelineVersion: session.pipelineVersion,
    legacy: true,
    status: session.status,
    title: titleValue(session.genre?.trim() || session.situation, "이전 버전 연습"),
    preview: previewValue(session.situation),
    durationMs: session.take.durationMs,
    analysisStatus: session.take.analysisStatus,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };

  const actorTurn = [...session.turns].reverse().find(
    (turn) => turn.role === "actor" && turn.deliveryStatus === "completed",
  );
  return {
    id: session.id,
    pipelineVersion: session.pipelineVersion,
    legacy: false,
    status: session.status,
    title: titleValue(session.situation, "연기 연습"),
    preview: previewValue(
      session.report?.headline || actorTurn?.text || session.sceneSummary?.summary || session.situation,
    ),
    durationMs: session.take.durationMs,
    analysisStatus: session.take.analysisStatus,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}
