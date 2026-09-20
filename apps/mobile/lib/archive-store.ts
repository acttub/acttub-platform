import { Directory, File, Paths } from 'expo-file-system';

/**
 * 보관함(기기 저장 촬영본) — "기본 촬영"으로 찍은 영상을 앱 문서 폴더에 복사해 두고
 * 목록은 AsyncStorage에 JSON으로 든다. 서버로는 안 간다.
 * (CI mobile 잡이 무설치 node --test 라 AsyncStorage 는 lazy require.)
 */

const KEY = 'acttub.archive.v1';

export type ArchiveRecording = {
  id: string;
  /** 앱 문서 폴더 안의 복사본. 복사에 실패하면 원본 uri. */
  uri: string;
  durationSec: number | null;
  /** ISO */
  createdAt: string;
  favorite: boolean;
};

type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

function storage(): Storage {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@react-native-async-storage/async-storage').default as Storage;
}

export async function listArchive(): Promise<ArchiveRecording[]> {
  try {
    const raw = await storage().getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed) ? (parsed as ArchiveRecording[]) : [];
  } catch {
    return [];
  }
}

async function save(list: ArchiveRecording[]): Promise<void> {
  await storage().setItem(KEY, JSON.stringify(list));
}

function archiveDir(): Directory {
  const dir = new Directory(Paths.document, 'archive');
  try {
    dir.create({ intermediates: true, idempotent: true });
  } catch {
    // 이미 있거나 못 만들면 그대로 — 복사가 실패하면 원본 uri를 쓴다
  }
  return dir;
}

/** 촬영 결과를 보관함에 넣는다. 파일은 문서 폴더로 복사(캐시가 지워져도 남게). 최신이 앞. */
export async function addArchiveRecording(input: {
  uri: string;
  durationMs: number | null;
}): Promise<ArchiveRecording> {
  const id = `rec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  let uri = input.uri;
  try {
    const dest = new File(archiveDir(), `${id}.mp4`);
    new File(input.uri).copy(dest);
    uri = dest.uri;
  } catch {
    // 복사 실패 — 원본 그대로 가리킨다
  }
  const rec: ArchiveRecording = {
    id,
    uri,
    durationSec: input.durationMs ? Math.round(input.durationMs / 1000) : null,
    createdAt: new Date().toISOString(),
    favorite: false,
  };
  const list = await listArchive();
  await save([rec, ...list]);
  return rec;
}

export async function setArchiveFavorite(id: string, favorite: boolean): Promise<void> {
  const list = await listArchive();
  await save(list.map((r) => (r.id === id ? { ...r, favorite } : r)));
}

export async function removeArchiveRecording(id: string): Promise<void> {
  const list = await listArchive();
  const target = list.find((r) => r.id === id);
  if (target) {
    try {
      const f = new File(target.uri);
      if (f.exists) f.delete();
    } catch {
      // 파일이 이미 없어도 목록에서는 뺀다
    }
  }
  await save(list.filter((r) => r.id !== id));
}
