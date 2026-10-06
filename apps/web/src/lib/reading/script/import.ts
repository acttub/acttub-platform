/**
 * 대본 넣기 한 번의 흐름(reading.script 「나누기 작업」·「원본 파일」). 파일이면 올릴 자리 → S3 PUT → 글자 뽑기를 거쳐
 * upload_id 를, 글이면 그대로 서버에 맡기고 작업을 1초마다 물어 끝을 기다린다. 결과는 화면이 띄울 대화상자 하나로 접는다.
 * 서버 호출은 deps 로 받아 화면 없이 테스트한다.
 */
import { ApiError, errorMessage, isRateLimited, NetworkError, READING_SCRIPT_MESSAGES } from "../../api/v2/errors";
import type { ConsentDocument } from "../../api/v2/types";
import type { ImportRequest, ImportTicket, ScriptImport, ScriptUpload } from "../api-types";
import { newRequestId } from "../request-id";

export type TextSource = "paste" | "typed" | "sample";

export type ScriptInput = { kind: "text"; text: string; source: TextSource } | { kind: "file"; file: File };

/** 서버에 한 번 맡기는 단위. 같은 요청 id 로 다시 보내면 서버에서 같은 작업이다. */
export interface ImportAttempt {
  input: ScriptInput;
  requestId: string;
  /** 이미 올려 글자를 뽑아 둔 파일. 플래그를 바꿔 다시 맡길 때 파일을 다시 올리지 않는다. */
  uploadId: string | null;
  /** R2.7 [새로 넣기] */
  allowDuplicate: boolean;
  /** R2.8 [그래도 나누기] */
  skipScriptCheck: boolean;
}

export type ImportOutcome =
  | { kind: "saved"; scriptId: string }
  /** R2.7 */
  | { kind: "duplicate"; scriptId: string }
  /** R2.8 */
  | { kind: "not_script" }
  /** R2.13 */
  | { kind: "no_characters" }
  /** R2.14. error 는 동의를 저장하지 못한 까닭 */
  | { kind: "consent_required"; error?: string }
  /** R2.15 */
  | { kind: "daily_limit" }
  /** R2.4 */
  | { kind: "file_too_large" }
  /** R2.4 */
  | { kind: "file_unreadable" }
  /** R2.12 */
  | { kind: "failed"; message: string };

export interface ImportProgress {
  doneLines: number;
  totalLines: number;
}

export interface ImportDeps {
  createUpload: (file: File) => Promise<ScriptUpload>;
  putUpload: (upload: ScriptUpload, file: File) => Promise<void>;
  completeUpload: (uploadId: string) => Promise<void>;
  startImport: (body: Omit<ImportRequest, "request_id">, requestId: string) => Promise<ImportTicket>;
  getImport: (importId: string, signal?: AbortSignal) => Promise<ScriptImport>;
  listConsentDocuments: () => Promise<ConsentDocument[]>;
  grantConsent: (documentId: string) => Promise<void>;
  wait: (ms: number, signal?: AbortSignal) => Promise<void>;
  now: () => number;
}

export const FILE_MAX_BYTES = 50_000_000;
const FILE_EXTENSIONS = ["txt", "docx", "pdf", "hwp", "hwpx"];
/** 파일 고르기 창의 거르개. 브라우저가 hwp 의 종류를 모르는 일이 흔해 확장자로 건다. */
export const FILE_ACCEPT = FILE_EXTENSIONS.map((ext) => `.${ext}`).join(",");
export const POLL_INTERVAL_MS = 1_000;
/** 68편 실측 최대 36초. 워커가 죽으면 서버는 30분까지 running 이라 기기가 먼저 끊는다. */
export const IMPORT_TIMEOUT_MS = 120_000;

/** R2.12 공용 문구 */
export const IMPORT_FAILED_COPY = "네트워크 연결을 확인하고 다시 시도해주세요.";
const CONSENT_FAILED_COPY = "동의를 저장하지 못했어요. 다시 시도해 주세요.";

export function newAttempt(input: ScriptInput): ImportAttempt {
  return { input, requestId: newRequestId(), uploadId: null, allowDuplicate: false, skipScriptCheck: false };
}

/** 플래그를 켜 다시 맡긴다. 플래그는 요청 지문에 들어가므로 요청 id 가 새것이어야 한다. */
export function retryWith(attempt: ImportAttempt, flag: "allowDuplicate" | "skipScriptCheck"): ImportAttempt {
  return { ...attempt, requestId: newRequestId(), [flag]: true };
}

/** 올리기 전에 기기에서 거른다. 서버도 같은 규칙으로 422 를 준다. */
export function checkFile(file: File): ImportOutcome | null {
  if (file.size > FILE_MAX_BYTES) return { kind: "file_too_large" };
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  if (!file.name.includes(".") || !FILE_EXTENSIONS.includes(ext)) return { kind: "file_unreadable" };
  return null;
}

/** 작업 상태 하나를 결과로. 아직 끝나지 않았으면 null. */
export function outcomeOfImport(job: ScriptImport): ImportOutcome | null {
  if (job.status === "succeeded" && job.script_id) return { kind: "saved", scriptId: job.script_id };
  if (job.status !== "failed") return null;
  switch (job.failure) {
    case "not_script":
      return { kind: "not_script" };
    case "no_characters":
      return { kind: "no_characters" };
    case "script_too_long":
    case "script_limit":
      return { kind: "failed", message: READING_SCRIPT_MESSAGES[job.failure] };
    default:
      return { kind: "failed", message: IMPORT_FAILED_COPY };
  }
}

const ERROR_OUTCOMES: Record<string, ImportOutcome> = {
  script_split_consent_required: { kind: "consent_required" },
  script_split_daily_limit: { kind: "daily_limit" },
  script_file_too_large: { kind: "file_too_large" },
  script_file_unreadable: { kind: "file_unreadable" },
};

export function outcomeOfError(cause: unknown): ImportOutcome {
  if (cause instanceof ApiError && cause.code in ERROR_OUTCOMES) return ERROR_OUTCOMES[cause.code];
  return { kind: "failed", message: errorMessage(cause, IMPORT_FAILED_COPY) };
}

/** 폴링 한 번이 잠시 막힌 것. 기한 안에서 다음 차례에 다시 묻는다. */
function isTransient(cause: unknown): boolean {
  return cause instanceof NetworkError || isRateLimited(cause) || (cause instanceof ApiError && cause.status >= 500);
}

async function uploadFile(file: File, deps: ImportDeps): Promise<string> {
  const upload = await deps.createUpload(file);
  await deps.putUpload(upload, file);
  await deps.completeUpload(upload.upload_id);
  return upload.upload_id;
}

function requestBody(attempt: ImportAttempt): Omit<ImportRequest, "request_id"> {
  const flags = { allow_duplicate: attempt.allowDuplicate, skip_script_check: attempt.skipScriptCheck };
  return attempt.input.kind === "file"
    ? { upload_id: attempt.uploadId, source: "file", ...flags }
    : { raw_text: attempt.input.text, source: attempt.input.source, ...flags };
}

async function waitForImport(
  importId: string,
  deps: ImportDeps,
  onProgress: (progress: ImportProgress) => void,
): Promise<ImportOutcome> {
  const deadline = deps.now() + IMPORT_TIMEOUT_MS;
  while (deps.now() < deadline) {
    try {
      const job = await deps.getImport(importId);
      onProgress({ doneLines: job.progress.done_lines, totalLines: job.progress.total_lines });
      const outcome = outcomeOfImport(job);
      if (outcome) return outcome;
    } catch (cause) {
      if (!isTransient(cause)) return outcomeOfError(cause);
    }
    await deps.wait(POLL_INTERVAL_MS);
  }
  return { kind: "failed", message: IMPORT_FAILED_COPY };
}

/**
 * 한 번 맡기고 끝까지 기다린다. 돌려주는 attempt 에는 올린 파일의 id 가 들어 있어, 대화상자에서 다시 맡길 때 그대로 쓴다.
 */
export async function runImport(
  attempt: ImportAttempt,
  deps: ImportDeps,
  onProgress: (progress: ImportProgress) => void,
): Promise<{ outcome: ImportOutcome; attempt: ImportAttempt }> {
  let current = attempt;
  const submit = async () => {
    if (current.input.kind === "file" && current.uploadId === null) {
      current = { ...current, uploadId: await uploadFile(current.input.file, deps) };
    }
    return deps.startImport(requestBody(current), current.requestId);
  };
  try {
    if (current.input.kind === "file" && current.uploadId === null) {
      const rejected = checkFile(current.input.file);
      if (rejected) return { outcome: rejected, attempt: current };
    }
    let ticket: ImportTicket;
    try {
      ticket = await submit();
    } catch (cause) {
      // 들고 있던 upload_id 가 그새 대본이 됐다. 원본은 대본 하나에만 붙으므로 파일을 새로 올려 한 번 더 맡긴다.
      if (!(cause instanceof ApiError && cause.code === "script_upload_used")) throw cause;
      current = { ...current, uploadId: null, requestId: newRequestId() };
      ticket = await submit();
    }
    if (ticket.duplicate_script_id) return { outcome: { kind: "duplicate", scriptId: ticket.duplicate_script_id }, attempt: current };
    if (!ticket.import_id) return { outcome: { kind: "failed", message: IMPORT_FAILED_COPY }, attempt: current };
    return { outcome: await waitForImport(ticket.import_id, deps, onProgress), attempt: current };
  } catch (cause) {
    return { outcome: outcomeOfError(cause), attempt: current };
  }
}

/**
 * R2.14 [동의하고 나누기]. 현재 판 script_split 문서에 동의하고 막혔던 것을 같은 요청 id 로 다시 맡긴다.
 * 동의를 저장하지 못하면 대화상자를 그대로 두고 까닭을 싣는다.
 */
export async function agreeAndRetry(
  attempt: ImportAttempt,
  deps: ImportDeps,
  onProgress: (progress: ImportProgress) => void,
): Promise<{ outcome: ImportOutcome; attempt: ImportAttempt }> {
  try {
    const document = (await deps.listConsentDocuments()).find((d) => d.type === "script_split");
    if (!document) return { outcome: { kind: "failed", message: IMPORT_FAILED_COPY }, attempt };
    await deps.grantConsent(document.id);
  } catch (cause) {
    return { outcome: { kind: "consent_required", error: errorMessage(cause, CONSENT_FAILED_COPY) }, attempt };
  }
  return runImport(attempt, deps, onProgress);
}
