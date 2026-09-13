import type { components } from "@/lib/api/v2-schema";

export type VideoRecordSummary = components["schemas"]["VideoRecordSummaryResponse"];

/**
 * 영상만 올린 새 연습(three_layers_v1)의 상세 응답은 관찰 시점(observations) 대신 영상 기록
 * 요약을 준다. 장면 패널이 그릴 [라벨, 값] 줄로 바꾼다. legacy 요약이나 요약이 없으면 빈 배열이라
 * 호출하는 쪽은 분기 없이 같은 자리에 둘 수 있다.
 */
export function videoRecordRows(summary: unknown): [string, string][] {
  if (!isVideoRecordSummary(summary)) return [];
  const rows: [string, string][] = [];
  if (summary.observed_scene.length > 0) rows.push(["영상에서 본 것", summary.observed_scene.join(" ")]);
  if (summary.spoken_content.length > 0) rows.push(["들린 대사", summary.spoken_content.join(" / ")]);
  if (summary.limitations.length > 0) {
    rows.push([
      "확인하지 못한 것",
      summary.limitations.map((item) => `${range(item.start_ms, item.end_ms)} ${item.description}`).join(" / "),
    ]);
  }
  if (summary.status === "partial") {
    const missing = summary.missing_ranges.map((item) => range(item.start_ms, item.end_ms)).join(", ");
    rows.push(["기록 상태", `일부 구간은 기록하지 못했어요${missing ? ` (${missing})` : ""}`]);
  }
  return rows;
}

export function isVideoRecordSummary(value: unknown): value is VideoRecordSummary {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { schema_version?: unknown }).schema_version === "acttub.video_record_summary.v1"
  );
}

function range(startMs: number, endMs: number): string {
  return `${clock(startMs)}~${clock(endMs)}`;
}

function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
