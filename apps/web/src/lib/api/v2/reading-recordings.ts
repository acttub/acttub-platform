import { apiFetch } from "./client";
import type { SessionRecording } from "../../reading/api-types";
import { extensionFor } from "../../reading/recording/limits";

// 줄 단위 녹음 올리기·삭제(reading.recording). 올리기는 multipart 한 요청이고 파일은 브라우저가 내는 형식
// 그대로 content_type 을 정확히 실어 보낸다 — 서버가 m4a(AAC)로 바꿔 저장한다.

export interface RecordingUploadInput {
  /** 기기가 만든 UUID. 같은 요청 id 는 같은 행(멱등). 연결이 끊기면 같은 id 로 다시 보낸다. */
  requestId: string;
  lineId: string;
  /** 줄마다 1부터 1씩. 서버는 저장된 번호보다 큰 시도만 받아 대체한다. */
  attemptNo: number;
  blob: Blob;
  contentType: string;
  durationMs: number;
  transcript: string | null;
  transcriptSource: "stt" | "none";
  matched: boolean | null;
}

export type UploadRecordingResult = {
  /** 201 이면 새 행, 200 이면 같은 요청 id 의 재전송이거나 더 작은 시도 번호라 현재 값이 온 것 */
  created: boolean;
  recording: SessionRecording;
};

export async function uploadRecording(
  sessionId: string,
  input: RecordingUploadInput,
  options: { signal?: AbortSignal } = {},
): Promise<UploadRecordingResult> {
  const form = new FormData();
  form.set("request_id", input.requestId);
  form.set("line_id", input.lineId);
  form.set("attempt_no", String(input.attemptNo));
  form.set("audio", new File([input.blob], `line.${extensionFor(input.contentType)}`, { type: input.contentType }));
  form.set("duration_ms", String(input.durationMs));
  form.set("transcript_source", input.transcriptSource);
  if (input.transcript !== null) form.set("transcript", input.transcript);
  if (input.matched !== null) form.set("matched", String(input.matched));
  const { status, data } = await apiFetch<SessionRecording>(
    `/v2/reading/sessions/${encodeURIComponent(sessionId)}/recordings`,
    { method: "POST", body: form, headers: { "X-Request-Id": input.requestId }, signal: options.signal },
  );
  return { created: status === 201, recording: data };
}

/** 그 녹음의 행·객체가 지워진다. 회차 진행·암기 상태는 그대로다. */
export async function deleteRecording(recordingId: string): Promise<void> {
  await apiFetch<void>(`/v2/reading/recordings/${encodeURIComponent(recordingId)}`, { method: "DELETE" });
}
