/**
 * 1.0.0 이전 앱이 기기(AsyncStorage)에 남긴 대본을 서버로 옮긴다(reading.script 「옛 대본」).
 *
 * - 옛 대본에는 원문이 없다. 줄에서 "이름: 대사" 꼴로 되살린 글을 원문으로 두고 입력 경로는 paste다.
 * - 옛 암기 표시(memorized 줄 번호)는 새 줄 id에 대응해 memorized로 올린다(reading.memorization).
 * - 대본마다 서버 저장(과 암기 저장)이 확인된 뒤에만 그 로컬 자료를 지운다. 재시도는 같은 요청 id를 쓴다.
 * - 한도(script_limit)에 걸린 대본은 남겨 두고 "대본 N개를 옮기지 못했어요"를 보여 준다. 연결이 끊긴 것도
 *   남겨 다음 실행에 다시 한다.
 * - 옛 녹음(회차 전체 한 파일)은 줄 단위와 맞지 않아 올리지 않고 지운다. 안내 한 줄을 남긴다.
 *
 * 네이티브 모듈 없이 성립하도록 저장소·API·파일 삭제를 넣어 받는다(local-account-wipe 와 같은 방식).
 */
import { ApiError, NetworkError, RequestAbortError, classifyUnprocessable } from '../api-request.ts';
import type { ScriptLine } from './parse.ts';
import type { CreateScriptBody, MemorizationStatus, ScriptDetail } from './types.ts';

/** 옛 저장소 키. 'acttub.' 접두사라 탈퇴 때 함께 지워진다. */
export const LEGACY_SCRIPTS_KEY = 'acttub.reading.scripts';
/** 요청 id 장부와 옮긴 결과 안내. 같은 접두사. */
export const LEGACY_MIGRATION_KEY = 'acttub.reading.legacyMigration';

/** 옛 앱의 SavedScript 가운데 옮기는 데 필요한 부분. 나머지 필드는 무시한다. */
export type LegacyScript = {
  id: string;
  title?: string;
  roles?: string[];
  lines?: ScriptLine[];
  /** 외운 대사의 줄 인덱스(lines 배열 기준, 0부터). */
  memorized?: number[];
  recordings?: { uri?: string }[];
};

export type LegacyMigrationResult = {
  moved: number;
  /** 옮긴 암기 표시 수. */
  memorized: number;
  /** 한도(script_limit)에 걸려 남긴 대본 수. */
  limited: number;
  /** 연결·서버 오류로 남긴 대본 수. 다음 실행에 다시 한다. */
  failed: number;
};

export type LegacyNotice = LegacyMigrationResult & { at: number };

type MigrationState = {
  /** 옛 대본 id → 요청 id. 재시도가 같은 id를 쓰게 한다. */
  requestIds: Record<string, string>;
  /** 다시 보내도 같은 답인 422(한도 제외)로 거절된 대본. 남겨 두되 다시 보내지 않는다. */
  rejected: Record<string, string>;
  notice: LegacyNotice | null;
};

type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export type LegacyMigrationDependencies = {
  storage: Storage;
  createScript: (body: CreateScriptBody) => Promise<ScriptDetail>;
  setMemorization: (lineId: string, status: MemorizationStatus) => Promise<unknown>;
  /** 없는 파일이어도 던지지 않는다. */
  deleteFile: (uri: string) => Promise<void>;
  newRequestId: () => string;
  now?: () => number;
};

const UNTITLED = /^(제목 없는 대본|Untitled script)$/;
const WRAPPED_RE = /^[(\[（【].*[)\]）】]$/;

/** 줄에서 원문을 되살린다. 대사는 "이름: 대사", 지문은 괄호로 감싸 다시 나눠도 지문이 되게 한다. */
export function rebuildRawText(script: Pick<LegacyScript, 'title' | 'lines'>): string {
  const out: string[] = [];
  const title = script.title?.trim() ?? '';
  if (title && !UNTITLED.test(title)) out.push(title, '');
  for (const line of script.lines ?? []) {
    if (line.type === 'dialogue') out.push(`${line.role}: ${line.text}`);
    else if (line.type === 'direction') out.push(WRAPPED_RE.test(line.text) ? line.text : `(${line.text})`);
    else out.push(line.text);
  }
  return out.join('\n');
}

function toCreateBody(script: LegacyScript, requestId: string): CreateScriptBody {
  const roles = script.roles ?? [];
  const index = new Map(roles.map((role, i) => [role, i] as const));
  const lines = script.lines ?? [];
  return {
    request_id: requestId,
    title: script.title?.trim() || '제목 없는 대본',
    source: 'paste',
    raw_text: rebuildRawText(script),
    characters: roles.map((name) => ({ name })),
    lines: lines.map((line, i) => ({
      ordinal: i + 1,
      kind: line.type,
      character_index: line.type === 'dialogue' ? (index.get(line.role) ?? null) : null,
      text: line.text,
    })),
  };
}

async function readState(storage: Storage): Promise<MigrationState> {
  try {
    const raw = await storage.getItem(LEGACY_MIGRATION_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<MigrationState>) : {};
    return {
      requestIds: parsed.requestIds ?? {},
      rejected: parsed.rejected ?? {},
      notice: parsed.notice ?? null,
    };
  } catch {
    return { requestIds: {}, rejected: {}, notice: null };
  }
}

function writeState(storage: Storage, state: MigrationState): Promise<void> {
  return storage.setItem(LEGACY_MIGRATION_KEY, JSON.stringify(state));
}

async function readLegacyScripts(storage: Storage): Promise<LegacyScript[] | null> {
  try {
    const raw = await storage.getItem(LEGACY_SCRIPTS_KEY);
    if (!raw) return null;
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) ? list.filter((s): s is LegacyScript => !!s && typeof s.id === 'string') : [];
  } catch {
    return [];
  }
}

/** 옛 암기 표시(줄 인덱스)를 서버 줄 id로 옮긴다. 대사 줄만 대상이다. */
function memorizedLineIds(script: LegacyScript, detail: ScriptDetail): string[] {
  const byOrdinal = new Map(detail.lines.map((l) => [l.ordinal, l] as const));
  const ids: string[] = [];
  for (const index of script.memorized ?? []) {
    const line = byOrdinal.get(index + 1);
    if (line && line.kind === 'dialogue') ids.push(line.id);
  }
  return ids;
}

function isConnectionFailure(error: unknown): boolean {
  return error instanceof NetworkError || error instanceof RequestAbortError;
}

/** 같은 본문을 다시 보내도 답이 같을 422(한도만 빼고). */
function permanentRejection(error: unknown): string | null {
  const kind = classifyUnprocessable(error);
  if (!kind) return null;
  if (kind.kind === 'client_bug') return 'validation_error';
  return kind.code === 'script_limit' ? null : kind.code;
}

export async function migrateLegacyScripts(deps: LegacyMigrationDependencies): Promise<LegacyMigrationResult> {
  const result: LegacyMigrationResult = { moved: 0, memorized: 0, limited: 0, failed: 0 };
  const scripts = await readLegacyScripts(deps.storage);
  if (scripts === null) return result;
  if (scripts.length === 0) {
    await deps.storage.removeItem(LEGACY_SCRIPTS_KEY).catch(() => undefined);
    return result;
  }
  const state = await readState(deps.storage);

  // 옛 녹음 파일은 올리지 않고 지운다. 지운 뒤 목록에서도 빼 두어 다음 실행이 같은 파일을 다시 찾지 않게 한다.
  let remaining = scripts;
  const withRecordings = remaining.filter((s) => (s.recordings ?? []).length > 0);
  if (withRecordings.length > 0) {
    await Promise.allSettled(
      withRecordings.flatMap((s) => (s.recordings ?? []).map((r) => r.uri)).filter((uri): uri is string => !!uri).map(deps.deleteFile),
    );
    remaining = remaining.map((s) => ({ ...s, recordings: [] }));
    await deps.storage.setItem(LEGACY_SCRIPTS_KEY, JSON.stringify(remaining)).catch(() => undefined);
  }

  let stopped = false;
  for (const script of scripts) {
    if (stopped) {
      result.failed += 1;
      continue;
    }
    if (state.rejected[script.id]) continue;
    let requestId = state.requestIds[script.id];
    if (!requestId) {
      requestId = deps.newRequestId();
      state.requestIds[script.id] = requestId;
      await writeState(deps.storage, state);
    }
    try {
      const detail = await deps.createScript(toCreateBody(script, requestId));
      const lineIds = memorizedLineIds(script, detail);
      for (const lineId of lineIds) await deps.setMemorization(lineId, 'memorized');
      result.moved += 1;
      result.memorized += lineIds.length;
      remaining = remaining.filter((s) => s.id !== script.id);
      delete state.requestIds[script.id];
      // 대본마다 서버 저장이 확인된 뒤에만 그 로컬 자료를 지운다.
      await deps.storage.setItem(LEGACY_SCRIPTS_KEY, JSON.stringify(remaining));
      await writeState(deps.storage, state);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'script_limit') {
        result.limited += 1;
        continue;
      }
      const rejection = permanentRejection(error);
      if (rejection) {
        state.rejected[script.id] = rejection;
        await writeState(deps.storage, state).catch(() => undefined);
        result.failed += 1;
        continue;
      }
      result.failed += 1;
      // 연결이 끊겼으면 나머지도 실패할 것이다. 다음 실행으로 미룬다.
      if (isConnectionFailure(error)) stopped = true;
    }
  }

  if (remaining.length === 0) await deps.storage.removeItem(LEGACY_SCRIPTS_KEY).catch(() => undefined);
  if (result.moved + result.limited + result.failed > 0) {
    state.notice = { ...result, at: (deps.now ?? Date.now)() };
    await writeState(deps.storage, state).catch(() => undefined);
  }
  return result;
}

/** 옮긴 결과 안내(한 번). 없으면 null. */
export async function readLegacyNotice(storage: Storage): Promise<LegacyNotice | null> {
  return (await readState(storage)).notice;
}

export async function dismissLegacyNotice(storage: Storage): Promise<void> {
  const state = await readState(storage);
  if (!state.notice) return;
  await writeState(storage, { ...state, notice: null });
}
