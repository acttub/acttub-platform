/**
 * 대본 넣기(R2)의 서버 나누기(reading.script). 기기는 글이나 파일을 보내고 작업을 1초마다 물어 기다린다 —
 * 배역·대사는 서버가 나눠 바로 저장한다. 기기 파서는 없다: 서버가 실패하면 R2.12 를 띄우고 넣은 것은 R2에 남는다.
 *
 * 화면이 고를 팝업은 결과(ImportResult) 하나로 정해진다. 네트워크·저장소는 deps 로 받아 node 테스트가 가짜를 넣는다.
 */
import { errorCode, errorStatus } from '../api-request.ts';
import { translate as t } from '../i18n.ts';
import { isScriptFileTooLarge } from './file-input.ts';
import { scriptErrorMessage } from './script-errors.ts';
import type { ImportScriptBody, ImportTicket, ScriptImport, ScriptImportFailure, ScriptSource, ScriptUpload } from './types.ts';

/** 작업 하나를 묻는 간격. 서버 한도(회원당 분당 60회)에 맞춰 작업 하나만 이 간격으로 묻는다. */
export const POLL_MS = 1_000;
/** 앱이 기다리는 끝. 워커가 죽으면 서버는 30분까지 running 이라 그 전에 R2.12 로 끝낸다(68편 실측 최대 36초). */
export const IMPORT_TIMEOUT_MS = 120_000;

export type PickedScriptFile = { uri: string; name: string; size: number };

/** 넣을 것 하나. 붙여넣은(쓴) 글이거나, 올려 둔 파일이다. 파일은 원본이 다시 필요할 때(script_upload_used)를 위해 고른 파일도 든다. */
export type ImportInput =
  | { kind: 'text'; text: string; source: ScriptSource }
  | { kind: 'file'; file: PickedScriptFile; uploadId: string };

/** 같은 입력을 다시 보낼 때 붙이는 것. R2.7 [새로 넣기]·R2.8 [그래도 나누기]. */
export type ImportFlags = { allowDuplicate?: boolean; skipScriptCheck?: boolean };

/** 나누기가 저장까지 가지 못한 이유. 화면 팝업 하나에 대응한다. */
export type ImportStop =
  | { kind: 'consent' } // R2.14
  | { kind: 'daily_limit' } // R2.15
  | { kind: 'file_too_large' } // R2.4
  | { kind: 'file_unreadable' } // R2.4
  | { kind: 'duplicate'; scriptId: string } // R2.7
  | { kind: 'not_script' } // R2.8
  | { kind: 'no_characters' } // R2.13
  | { kind: 'too_long' } // R2.12
  | { kind: 'script_limit' } // R2.12
  | { kind: 'busy' } // R2.12, 서버의 읽기 자리가 없다. 올린 파일은 그대로 두고 [다음]에서 다시 읽는다
  | { kind: 'upload_used' } // 이미 대본이 된 원본. runScriptImport 가 다시 올려 한 번 더 보낸다
  | { kind: 'error'; message: string }; // R2.12 공용

export type ImportResult = { kind: 'saved'; scriptId: string } | ImportStop;

/** 요청마다 새 request_id 다. 같은 글을 두 번 눌러도 서버가 진행 중인 같은 작업을 돌려준다. */
export function importBody(input: ImportInput, flags: ImportFlags, requestId: string): ImportScriptBody {
  const common = {
    request_id: requestId,
    allow_duplicate: flags.allowDuplicate ?? false,
    skip_script_check: flags.skipScriptCheck ?? false,
  };
  return input.kind === 'text'
    ? { ...common, source: input.source, raw_text: input.text }
    : { ...common, source: 'file', upload_id: input.uploadId };
}

/** R2.7·R2.8 에서 다시 보낼 때 붙일 플래그. 그 밖의 멈춤은 다시 보낼 길이 없다. */
export function retryFlags(stop: ImportStop): ImportFlags | null {
  if (stop.kind === 'duplicate') return { allowDuplicate: true };
  if (stop.kind === 'not_script') return { skipScriptCheck: true };
  return null;
}

const STOP_BY_CODE: Record<string, ImportStop> = {
  script_split_consent_required: { kind: 'consent' },
  script_split_daily_limit: { kind: 'daily_limit' },
  script_file_too_large: { kind: 'file_too_large' },
  script_file_unreadable: { kind: 'file_unreadable' },
  script_too_long: { kind: 'too_long' },
  script_limit: { kind: 'script_limit' },
  script_upload_busy: { kind: 'busy' },
  script_upload_used: { kind: 'upload_used' },
};

/** 요청 오류 → 멈춤. 사유 코드가 없는 오류는 요청 계층의 문구 그대로 R2.12 다. */
export function stopOf(error: unknown): ImportStop {
  return STOP_BY_CODE[errorCode(error) ?? ''] ?? { kind: 'error', message: scriptErrorMessage(error) };
}

const STOP_BY_FAILURE: Record<ScriptImportFailure, () => ImportStop> = {
  not_script: () => ({ kind: 'not_script' }),
  no_characters: () => ({ kind: 'no_characters' }),
  script_too_long: () => ({ kind: 'too_long' }),
  script_limit: () => ({ kind: 'script_limit' }),
  failed: () => ({ kind: 'error', message: t('errors.network') }),
};

export type ImportDeps = {
  start: (body: ImportScriptBody) => Promise<ImportTicket>;
  get: (importId: string) => Promise<ScriptImport>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

export type ImportProgress = { done: number; total: number };

/**
 * 접수하고 끝날 때까지 기다린다. 첫 물음은 접수 바로 뒤다 — 예시 대본·같은 글은 곧 끝나 팝업이 바로 닫힌다.
 * 묻다가 연결이 끊기면 시간 초과까지 계속 묻는다(작업은 서버에서 돈다).
 */
export async function runImport(
  body: ImportScriptBody,
  deps: ImportDeps,
  onProgress: (progress: ImportProgress) => void,
): Promise<ImportResult> {
  const deadline = deps.now() + IMPORT_TIMEOUT_MS;
  let ticket: ImportTicket;
  try {
    ticket = await deps.start(body);
  } catch (error) {
    return stopOf(error);
  }
  if (ticket.duplicate_script_id) return { kind: 'duplicate', scriptId: ticket.duplicate_script_id };
  const importId = ticket.import_id;
  if (!importId) return STOP_BY_FAILURE.failed();
  while (true) {
    try {
      const job = await deps.get(importId);
      onProgress({ done: job.progress.done_lines, total: job.progress.total_lines });
      if (job.status === 'succeeded' && job.script_id) return { kind: 'saved', scriptId: job.script_id };
      if (job.status === 'failed') return STOP_BY_FAILURE[job.failure ?? 'failed']();
    } catch (error) {
      if (!isTransient(error)) return stopOf(error);
    }
    if (deps.now() + POLL_MS > deadline) return STOP_BY_FAILURE.failed();
    await deps.sleep(POLL_MS);
  }
}

/** 다시 물으면 풀릴 수 있는 오류 — 끊김·시간 초과·5xx·분당 한도. */
function isTransient(error: unknown): boolean {
  const status = errorStatus(error);
  return status === null || status === 0 || status === 429 || status >= 500;
}

export type UploadDeps = {
  create: (body: { file_name: string; byte_size: number }) => Promise<ScriptUpload>;
  put: (uploadUrl: string, uri: string, contentType: string) => Promise<void>;
  complete: (uploadId: string) => Promise<void>;
};

export type UploadResult = { kind: 'uploaded'; uploadId: string } | { kind: 'unread'; uploadId: string } | ImportStop;

/**
 * 고른 파일을 올리고 서버가 글자를 뽑게 한다(올릴 자리 → PUT → 읽기). 50MB 넘는 파일은 올리지 않는다.
 * 형식·글자 문제는 서버가 답한다(R2.4). 읽기 자리가 없으면(429) 올린 것은 두고 unread 다 — [다음]이 다시 읽는다.
 */
export async function uploadScriptFile(file: PickedScriptFile, deps: UploadDeps): Promise<UploadResult> {
  if (isScriptFileTooLarge(file.size)) return { kind: 'file_too_large' };
  let uploadId: string;
  try {
    const upload = await deps.create({ file_name: file.name, byte_size: file.size });
    await deps.put(upload.upload_url, file.uri, upload.content_type);
    uploadId = upload.upload_id;
  } catch (error) {
    return stopOf(error);
  }
  try {
    await deps.complete(uploadId);
    return { kind: 'uploaded', uploadId };
  } catch (error) {
    const stop = stopOf(error);
    return stop.kind === 'busy' ? { kind: 'unread', uploadId } : stop;
  }
}

export type ScriptImportDeps = { import: ImportDeps; upload: UploadDeps; newRequestId: () => string };

/**
 * [다음] 한 번. 파일은 먼저 읽기를 다시 부른다(읽은 원본이면 서버가 바로 204 — 고를 때 읽기 자리가 없던 파일도 여기서 읽힌다).
 * 원본이 이미 대본이 됐으면(script_upload_used) 고른 파일을 다시 올려 새 upload_id 로 한 번 더 보내고 onUploaded 로 알린다.
 */
export async function runScriptImport(
  input: ImportInput,
  flags: ImportFlags,
  deps: ScriptImportDeps,
  onProgress: (progress: ImportProgress) => void,
  onUploaded: (uploadId: string) => void,
): Promise<ImportResult> {
  if (input.kind === 'text') return runImport(importBody(input, flags, deps.newRequestId()), deps.import, onProgress);
  try {
    await deps.upload.complete(input.uploadId);
  } catch (error) {
    return stopOf(error);
  }
  const result = await runImport(importBody(input, flags, deps.newRequestId()), deps.import, onProgress);
  if (result.kind !== 'upload_used') return result;
  const again = await uploadScriptFile(input.file, deps.upload);
  if (again.kind === 'unread') return { kind: 'busy' };
  if (again.kind !== 'uploaded') return again;
  onUploaded(again.uploadId);
  return runImport(importBody({ ...input, uploadId: again.uploadId }, flags, deps.newRequestId()), deps.import, onProgress);
}

/** [확인] 하나짜리 알림의 글(R2.4·R2.12·R2.13·R2.15). 동의·중복·대본 아님은 버튼이 다른 팝업이라 null. */
export function importAlert(stop: ImportStop): { title: string; message: string } | null {
  switch (stop.kind) {
    case 'consent':
    case 'duplicate':
    case 'not_script':
      return null;
    case 'file_too_large':
      return { title: t('reading.readFail'), message: t('reading.fileTooLarge') };
    case 'file_unreadable':
      return { title: t('reading.readFail'), message: t('reading.fileUnreadable') };
    case 'no_characters':
      return { title: t('reading.noCharactersTitle'), message: t('reading.noCharactersBody') };
    case 'daily_limit':
      return { title: t('reading.dailyLimitTitle'), message: t('reading.dailyLimitBody') };
    case 'too_long':
      return { title: t('common.save'), message: t('reading.errorScriptTooLong') };
    case 'script_limit':
      return { title: t('common.save'), message: t('reading.errorScriptLimit') };
    case 'busy':
      return { title: t('common.save'), message: t('errors.rateLimited') };
    case 'upload_used':
      return { title: t('common.save'), message: t('errors.network') };
    case 'error':
      return { title: t('common.save'), message: stop.message };
  }
}

/** 동의 항목 가운데 대본 나누기 문서(현재 판). 법무 문서가 발행되기 전에는 없다. */
export function scriptSplitDocument<D extends { type: string }>(documents: readonly D[]): D | null {
  return documents.find((d) => d.type === 'script_split') ?? null;
}
