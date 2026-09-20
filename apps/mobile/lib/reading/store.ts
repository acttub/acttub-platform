/**
 * 대본 리딩 저장소(reading.script) — 서버가 정본이다(ADR-031). 목록·상세·저장·수정·삭제는 리딩 API로
 * 가고, 화면 사이에 동기로 넘겨야 하는 "현재 대본" 하나만 메모리에 든다.
 *
 * 1.0.0 이전에는 대본이 AsyncStorage(`acttub.reading.scripts`)에만 있었다. 그 키는 이제 옛 대본을
 * 서버로 옮기는 legacy-migration 만 읽고, 여기서는 쓰지 않는다.
 *
 * 회차가 서버에 오기 전까지(RM2) 기기가 대본마다 기억하는 것 — 가리기·내 배역·진행 위치 — 은
 * `acttub.reading.devicePrefs` 에 둔다. 가리기는 요구사항대로 계속 기기 것이고, 나머지는 서버 회차가
 * 대신하게 될 임시다. 옛 회차 전체 녹음(addRecording)은 줄 단위 녹음(RM3)이 오기 전까지 메모리에만 둔다.
 *
 * CI mobile 잡이 무설치 node --test 라 AsyncStorage·api 는 함수 안에서 lazy require 하고, 테스트는
 * configureScriptTransport 로 가짜 서버를 넣는다.
 */
import { LEGACY_SCRIPTS_KEY } from './legacy-migration.ts';
import type { ScriptLine } from './parse.ts';
import { createDraft, validateDraft, type ScriptDraft } from './script-draft.ts';
import type {
  CreateScriptBody,
  PatchScriptBody,
  ScriptCharacter,
  ScriptDetail,
  ScriptListResponse,
  ScriptSource,
} from './types.ts';

/** 기기 쪽 진행 상태. 서버 회차(reading.session)가 오면 그것으로 바뀐다. */
export type ScriptStatus = 'draft' | 'reading' | 'done';
export type MaskMode = 'none' | 'mine' | 'all';

/** 옛 회차 전체 녹음. 줄 단위 녹음(reading.recording)이 오기 전까지 메모리에만 남는다. */
export interface Recording {
  id: string;
  uri: string;
  durationSec: number;
  coveredCount: number; // 이 회차에 지나간 대사 수
  totalCount: number; // 구간 전체 대사 수
  createdAt: number;
}

/** 기기가 대본마다 기억하는 것. */
export type DevicePrefs = {
  maskMode: MaskMode;
  myRoles: string[];
  index: number;
  startIndex: number;
  endIndex: number;
  status: ScriptStatus;
};

/** 화면이 쓰는 현재 대본. 서버 상세에 기기 설정을 얹은 모양이다. */
export interface SavedScript extends DevicePrefs {
  id: string;
  title: string;
  source: ScriptSource;
  /** 배역 이름(등장 순서). 줄의 role 과 같은 값이다. */
  roles: string[];
  characters: ScriptCharacter[];
  lines: ScriptLine[];
  /** lines 와 같은 순서의 서버 줄 id. 회차·녹음·암기가 이 id 를 가리킨다. */
  lineIds: string[];
  dialogueCount: number;
  /** 모든 회차의 녹음 수(서버 집계). */
  recordingCount: number;
  openSessionId: string | null;
  /** 옛 회차 전체 녹음(메모리). */
  recordings: Recording[];
  /** 외운 대사(줄 인덱스). 암기 상태가 서버로 가면(RM4) 없어진다. */
  memorized: number[];
  createdAt: number;
  updatedAt: number;
}

/** 옛 대본 저장소 키. 탈퇴(local-account-wipe)가 녹음 파일을 찾을 때 읽는다. */
export const READING_SCRIPTS_KEY = LEGACY_SCRIPTS_KEY;
const DEVICE_PREFS_KEY = 'acttub.reading.devicePrefs';

/**
 * 옛 저장소에 남은 대본들의 연습 녹음 파일 uri. 탈퇴 때 저장소 키를 지우기 전에 파일부터 지우려고 읽는다
 * (키가 사라지면 파일을 찾을 길이 없다). 값이 깨져 있으면 빈 목록이다.
 */
export function recordingFileUris(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const scripts = JSON.parse(raw) as unknown;
    if (!Array.isArray(scripts)) return [];
    return scripts.flatMap((script) =>
      Array.isArray(script?.recordings)
        ? script.recordings
            .map((recording: { uri?: unknown } | null) => recording?.uri)
            .filter((uri: unknown): uri is string => typeof uri === 'string' && uri.length > 0)
        : [],
    );
  } catch {
    return [];
  }
}

// ── 서버 ─────────────────────────────────────────────────────────────────────

export type ScriptTransport = {
  list(q?: string): Promise<ScriptListResponse>;
  get(id: string): Promise<ScriptDetail>;
  create(body: CreateScriptBody): Promise<ScriptDetail>;
  patch(id: string, body: PatchScriptBody): Promise<ScriptDetail>;
  remove(id: string): Promise<void>;
};

let transport: ScriptTransport | null = null;

/** 테스트가 가짜 서버를 넣는다. null 이면 lib/api 로 돌아간다. */
export function configureScriptTransport(next: ScriptTransport | null): void {
  transport = next;
}

function server(): ScriptTransport {
  if (transport) return transport;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { api } = require('../api') as typeof import('../api');
  transport = {
    list: (q) => api.listReadingScripts(q),
    get: (id) => api.getReadingScript(id),
    create: (body) => api.createReadingScript(body),
    patch: (id, body) => api.updateReadingScript(id, body),
    remove: (id) => api.deleteReadingScript(id),
  };
  return transport;
}

function storage() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@react-native-async-storage/async-storage').default;
}

/** 요청 id(UUID). 초안마다 하나라 연결이 끊겨 다시 보내도 대본이 둘이 되지 않는다. */
export function newRequestId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  const part = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${part()}${part()}-${part()}-4${part().slice(1)}-${part()}-${part()}${part()}${part()}`;
}

// ── 기기 설정 ─────────────────────────────────────────────────────────────────

const DEFAULT_PREFS: DevicePrefs = { maskMode: 'none', myRoles: [], index: 0, startIndex: 0, endIndex: 0, status: 'draft' };

async function readPrefs(): Promise<Record<string, Partial<DevicePrefs>>> {
  try {
    const raw = await storage().getItem(DEVICE_PREFS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, Partial<DevicePrefs>>) : {};
  } catch {
    return {};
  }
}

async function writePrefs(id: string, prefs: DevicePrefs | null): Promise<void> {
  try {
    const all = await readPrefs();
    if (prefs) all[id] = prefs;
    else delete all[id];
    await storage().setItem(DEVICE_PREFS_KEY, JSON.stringify(all));
  } catch {}
}

function prefsOf(script: SavedScript): DevicePrefs {
  return {
    maskMode: script.maskMode,
    myRoles: script.myRoles,
    index: script.index,
    startIndex: script.startIndex,
    endIndex: script.endIndex,
    status: script.status,
  };
}

// ── 서버 상세 → 화면 모양 ─────────────────────────────────────────────────────

export function toSavedScript(detail: ScriptDetail, prefs: Partial<DevicePrefs> = {}): SavedScript {
  const characters = [...detail.characters].sort((a, b) => a.order - b.order);
  const nameOf = new Map(characters.map((c) => [c.id, c.name] as const));
  const lines = [...detail.lines].sort((a, b) => a.ordinal - b.ordinal);
  const screenLines: ScriptLine[] = lines.map((line) =>
    line.kind === 'dialogue'
      ? { type: 'dialogue', role: nameOf.get(line.character_id ?? '') ?? '', text: line.text }
      : { type: line.kind, text: line.text },
  );
  const endIndex = Math.max(0, screenLines.length - 1);
  const merged: DevicePrefs = { ...DEFAULT_PREFS, endIndex, ...prefs };
  return {
    ...merged,
    id: detail.id,
    title: detail.title,
    source: detail.source,
    roles: characters.map((c) => c.name),
    characters,
    lines: screenLines,
    lineIds: lines.map((l) => l.id),
    dialogueCount: screenLines.filter((l) => l.type === 'dialogue').length,
    recordingCount: detail.recording_count,
    openSessionId: detail.open_session_id,
    recordings: [],
    memorized: [],
    createdAt: Date.parse(detail.created_at) || 0,
    updatedAt: Date.parse(detail.updated_at) || 0,
  };
}

// ── 목록·상세·저장·수정·삭제 ───────────────────────────────────────────────────

/** 최근 고친 순 목록(서버). q 는 제목·배역 이름만 찾는다. */
export function listScripts(q?: string): Promise<ScriptListResponse> {
  return server().list(q?.trim() || undefined);
}

let current: SavedScript | null = null;
let pendingDraft: ScriptDraft | null = null;

export function getCurrent(): SavedScript | null {
  return current;
}

/** 메모리의 현재 대본·초안을 비운다. 모듈 변수라 탈퇴로 저장소를 지워도 남기 때문이다. */
export function resetReadingState(): void {
  current = null;
  pendingDraft = null;
}

export function isMyRole(role: string): boolean {
  return (current?.myRoles ?? []).includes(role);
}

/** 서버 상세를 현재 대본으로 올린다(기기 설정을 얹어서). */
export async function openScript(detail: ScriptDetail): Promise<SavedScript> {
  const prefs = (await readPrefs())[detail.id] ?? {};
  current = toSavedScript(detail, prefs);
  return current;
}

/** 저장된 대본을 현재 대본으로 불러온다. 없거나 남의 것이면(404) null. */
export async function loadIntoCurrent(id: string): Promise<SavedScript | null> {
  try {
    const detail = await server().get(id);
    const recordings = current?.id === id ? current.recordings : [];
    const memorized = current?.id === id ? current.memorized : [];
    const opened = await openScript(detail);
    current = { ...opened, recordings, memorized };
    return current;
  } catch {
    if (current?.id === id) current = null;
    return null;
  }
}

/** 현재 대본에 부분 수정을 적용한다. 기기가 기억할 것은 저장소에도 적는다. */
export async function updateCurrent(patch: Partial<SavedScript>): Promise<void> {
  if (!current) return;
  current = { ...current, ...patch, updatedAt: Date.now() };
  await writePrefs(current.id, prefsOf(current));
}

/** 옛 회차 전체 녹음 1회를 현재 대본에 붙인다(메모리, 최신이 앞). 줄 단위 녹음이 오면 없어진다. */
export async function addRecording(rec: Omit<Recording, 'id' | 'createdAt'>): Promise<void> {
  if (!current) return;
  const full: Recording = { ...rec, id: `r_${Date.now()}`, createdAt: Date.now() };
  current = { ...current, recordings: [full, ...current.recordings], updatedAt: Date.now() };
}

// ── 초안(확인 화면) ────────────────────────────────────────────────────────────

/** 넣은 글로 초안을 만든다. 요청 id 는 여기서 한 번 정해진다. */
export function newDraft(rawText: string, source: ScriptSource): ScriptDraft {
  return createDraft(rawText, source, newRequestId());
}

/** 등록 화면이 확인 화면으로 넘기는 초안. 확인 화면을 떠나면 버린다. */
export function setPendingDraft(draft: ScriptDraft | null): void {
  pendingDraft = draft;
}

export function getPendingDraft(): ScriptDraft | null {
  return pendingDraft;
}

/**
 * 초안을 한 요청으로 저장한다. 기기가 먼저 거르고(코드는 Error.message), 서버가 거절하면 ApiError 다.
 * 같은 초안을 다시 보내도 request_id 가 같아 서버는 먼저 만든 대본을 돌려준다.
 */
export async function saveDraft(draft: ScriptDraft): Promise<SavedScript> {
  const checked = validateDraft(draft);
  if (!checked.ok) throw new Error(checked.code);
  const detail = await server().create(checked.body);
  pendingDraft = null;
  return openScript(detail);
}

/** 제목·배역 이름만 고친다(R00.3). 줄·배역 id·목소리는 그대로다. */
export async function updateScriptMeta(
  id: string,
  patch: { title?: string; characters?: { id: string; name: string }[] },
): Promise<ScriptDetail> {
  const body: PatchScriptBody = {};
  if (patch.title !== undefined) body.title = patch.title;
  if (patch.characters) body.characters = patch.characters.map((c) => ({ id: c.id, name: c.name }));
  const detail = await server().patch(id, body);
  if (current?.id === id) {
    const kept = current;
    current = { ...(await openScript(detail)), recordings: kept.recordings, memorized: kept.memorized };
  }
  return detail;
}

/** 대본을 지운다(R00.4). 배역·줄·회차·녹음·암기 상태가 서버에서 함께 지워진다. */
export async function deleteScript(id: string): Promise<void> {
  await server().remove(id);
  if (current?.id === id) current = null;
  await writePrefs(id, null);
}
