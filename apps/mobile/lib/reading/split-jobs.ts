/**
 * 서버가 나누고 있는 대본 작업의 기기 기록(reading.script 「나누기 작업」, SOMA-976). 서버에 진행 중 작업 목록이 없어
 * 접수한 작업 id·제목을 AsyncStorage 에 두고 리딩 탭이 하나씩 묻는다. 그래서 같은 기기에서 넣은 대본만 보인다.
 * 남의 작업은 서버가 404 를 줘 지워지므로 다른 계정으로 로그인해도 제목이 보이지 않는다.
 */
import { errorCode } from '../api-request.ts';
import { splitProgressView, type ImportInput } from './script-import.ts';
import { titleFromFileName } from './script-input.ts';
import type { ScriptImport } from './types.ts';

export const SPLIT_JOBS_KEY = 'acttub.reading.splitJobs';

export type SplitJob = { importId: string; title: string };

type Storage = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> };

const deviceStorage: Storage = {
  // CI 의 무설치 node --test 를 위해 함수 안에서 require 한다(reading/store.ts 와 같다).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  getItem: (key) => require('@react-native-async-storage/async-storage').default.getItem(key),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  setItem: (key, value) => require('@react-native-async-storage/async-storage').default.setItem(key, value),
};

export async function readSplitJobs(storage: Storage = deviceStorage): Promise<SplitJob[]> {
  try {
    const parsed: unknown = JSON.parse((await storage.getItem(SPLIT_JOBS_KEY)) ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// 접수와 지우기가 겹쳐도 서로의 쓰기를 덮지 않게 차례로 쓴다. 기록은 곁다리라 실패해도 나누기를 막지 않는다.
let writes: Promise<void> = Promise.resolve();
function update(change: (jobs: SplitJob[]) => SplitJob[], storage: Storage): Promise<void> {
  writes = writes
    .then(async () => storage.setItem(SPLIT_JOBS_KEY, JSON.stringify(change(await readSplitJobs(storage)))))
    .catch(() => undefined);
  return writes;
}

/** 같은 글로 진행 중인 작업은 서버가 같은 id 를 돌려주므로 하나로 둔다. 새 작업이 위다. */
export function addSplitJob(job: SplitJob, storage: Storage = deviceStorage): Promise<void> {
  return update((jobs) => [job, ...jobs.filter((other) => other.importId !== job.importId)], storage);
}

export function removeSplitJob(importId: string, storage: Storage = deviceStorage): Promise<void> {
  return update((jobs) => jobs.filter((job) => job.importId !== importId), storage);
}

/** 행에 보일 제목. 적은 제목 → 파일 이름이고, 붙여넣은 글에 제목이 없으면 빈 글이다(화면이 「제목 없는 대본」으로 보인다). */
export function splitJobTitle(input: ImportInput, title?: string): string {
  return title?.trim() || (input.kind === 'file' ? titleFromFileName(input.file.name) : '');
}

export type SplitJobCheck = { kind: 'running'; pct: number } | { kind: 'succeeded' } | { kind: 'failed' } | { kind: 'gone' } | { kind: 'unknown' };

/** 작업을 한 번 묻는다. 끊김·5xx·분당 한도는 unknown 이라 행을 그대로 두고 다음 차례에 다시 묻는다. */
export async function checkSplitJob(importId: string, get: (id: string) => Promise<ScriptImport>): Promise<SplitJobCheck> {
  try {
    const job = await get(importId);
    if (job.status === 'succeeded') return { kind: 'succeeded' };
    if (job.status === 'failed') return { kind: 'failed' };
    const { done_lines: done, total_lines: total, percent } = job.progress;
    return { kind: 'running', pct: splitProgressView({ done, total, percent: percent ?? null }).pct };
  } catch (error) {
    return errorCode(error) === 'import_not_found' ? { kind: 'gone' } : { kind: 'unknown' };
  }
}
