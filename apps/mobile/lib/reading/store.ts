/**
 * 대본 리딩 저장소 (SOMA-527) — 내 대본 목록 영속화 + 현재 진행 중 세션.
 *
 * 목록은 AsyncStorage 에 JSON 으로 저장한다. 진행 중인 대본 하나는 화면 간 동기 접근이
 * 필요해 메모리(current)에도 들고, 바뀔 때마다 저장소에 반영한다.
 * (CI mobile 잡이 무설치 node --test 라 AsyncStorage 는 함수 안에서 lazy require.)
 */
import type { ParsedScript, ScriptLine } from './parse';

export type ScriptStatus = 'draft' | 'reading' | 'done';
export type MaskMode = 'none' | 'mine' | 'all';

export interface SavedScript {
  id: string;
  title: string;
  roles: string[];
  lines: ScriptLine[];
  myRoles: string[];
  index: number; // 진행 위치(현재 줄)
  status: ScriptStatus;
  dialogueCount: number;
  /** 연습 범위(줄 인덱스). 미설정이면 전체. */
  startIndex: number;
  endIndex: number;
  /** 대사 가리기: none=다 보임, mine=내 대사 가림, all=전부 가림 */
  maskMode: MaskMode;
  /** 외운 대사(줄 인덱스) 집합 — R04 암기용 */
  memorized: number[];
  createdAt: number;
  updatedAt: number;
}

const KEY = 'acttub.reading.scripts';

function storage() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('@react-native-async-storage/async-storage').default;
}

function normalize(s: any): SavedScript {
  const lines = Array.isArray(s.lines) ? s.lines : [];
  return {
    ...s,
    startIndex: typeof s.startIndex === 'number' ? s.startIndex : 0,
    endIndex: typeof s.endIndex === 'number' ? s.endIndex : Math.max(0, lines.length - 1),
    maskMode: s.maskMode ?? 'none',
    memorized: Array.isArray(s.memorized) ? s.memorized : [],
  };
}

async function readAll(): Promise<SavedScript[]> {
  try {
    const raw = await storage().getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map(normalize) : [];
  } catch {
    return [];
  }
}

async function writeAll(list: SavedScript[]): Promise<void> {
  try {
    await storage().setItem(KEY, JSON.stringify(list));
  } catch {}
}

/** 최근 수정 순 목록. */
export async function listScripts(): Promise<SavedScript[]> {
  const list = await readAll();
  return list.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteScript(id: string): Promise<void> {
  const list = await readAll();
  await writeAll(list.filter((s) => s.id !== id));
  if (current?.id === id) current = null;
}

// ── 진행 중 세션 (메모리 + 저장소) ────────────────────────────────

let current: SavedScript | null = null;

export function getCurrent(): SavedScript | null {
  return current;
}

export function isMyRole(role: string): boolean {
  return (current?.myRoles ?? []).includes(role);
}

function newId(): string {
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/** 파싱 결과로 새 대본 초안을 만들고 현재 세션에 올린다(저장까지). */
export async function createFromParsed(p: ParsedScript): Promise<SavedScript> {
  const now = Date.now();
  const script: SavedScript = {
    id: newId(),
    title: p.title ?? '제목 없는 대본',
    roles: p.roles,
    lines: p.lines,
    myRoles: [],
    index: 0,
    status: 'draft',
    dialogueCount: p.lines.filter((l) => l.type === 'dialogue').length,
    startIndex: 0,
    endIndex: Math.max(0, p.lines.length - 1),
    maskMode: 'none',
    memorized: [],
    createdAt: now,
    updatedAt: now,
  };
  current = script;
  await upsert(script);
  return script;
}

/** 저장된 대본을 현재 세션으로 불러온다. */
export async function loadIntoCurrent(id: string): Promise<SavedScript | null> {
  const list = await readAll();
  const found = list.find((s) => s.id === id) ?? null;
  current = found ? { ...found } : null;
  return current;
}

/** 현재 세션에 부분 수정을 적용하고 저장한다. */
export async function updateCurrent(patch: Partial<SavedScript>): Promise<void> {
  if (!current) return;
  current = { ...current, ...patch, updatedAt: Date.now() };
  await upsert(current);
}

async function upsert(script: SavedScript): Promise<void> {
  const list = await readAll();
  const i = list.findIndex((s) => s.id === script.id);
  if (i >= 0) list[i] = script;
  else list.push(script);
  await writeAll(list);
}
