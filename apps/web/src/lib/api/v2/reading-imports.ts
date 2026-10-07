import { defaultUploader } from "../../media/s3-uploader";
import { apiFetch } from "./client";
import { postIdempotent } from "./idempotency";
import type { ImportRequest, ImportTicket, ScriptImport, ScriptUpload } from "../../reading/api-types";

// 대본 넣기(reading.script 「나누기 작업」·「원본 파일」). 서버가 글을 나눠 바로 저장하고, 기기는 작업을 물어 기다린다.

/** 나누기를 맡긴다. 같은 요청 id 의 재전송은 서버에서 같은 작업이다. */
export async function startImport(
  body: Omit<ImportRequest, "request_id">,
  requestId: string,
): Promise<ImportTicket> {
  const { data } = await postIdempotent<ImportTicket>(
    "/v2/reading/imports",
    { request_id: requestId, ...body },
    { requestId },
  );
  return data;
}

export async function getImport(importId: string, signal?: AbortSignal): Promise<ScriptImport> {
  const { data } = await apiFetch<ScriptImport>(`/v2/reading/imports/${encodeURIComponent(importId)}`, { signal });
  return data;
}

/** 원본 파일을 올릴 자리. 확장자와 크기는 서버가 다시 거른다. */
export async function createUpload(file: File): Promise<ScriptUpload> {
  const { data } = await apiFetch<ScriptUpload>("/v2/reading/uploads", {
    method: "POST",
    body: { file_name: file.name, byte_size: file.size },
  });
  return data;
}

export async function putUpload(upload: ScriptUpload, file: File): Promise<void> {
  await defaultUploader({ url: upload.upload_url, file, contentType: upload.content_type });
}

/** 올린 파일에서 서버가 글자를 뽑는다. 다시 불러도 같다. */
export async function completeUpload(uploadId: string): Promise<void> {
  await apiFetch<void>(`/v2/reading/uploads/${encodeURIComponent(uploadId)}/complete`, { method: "POST" });
}
