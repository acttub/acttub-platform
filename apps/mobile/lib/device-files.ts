/**
 * 이 기기에 만든 계정 자료 파일의 장부(account.withdraw).
 *
 * 앱은 올리기 전에 사진·영상을 줄인 파일을 만들고, 고르거나 찍은 영상의 복사본을 캐시에 둔다.
 * 파일 이름이 제멋대로라 나중에 폴더를 뒤져서는 찾지 못한다. 그래서 만들 때 여기에 적는다.
 *
 * - 임시 파일(줄인 사진·영상): 올리기가 끝나면(성공·실패·취소 모두) 바로 지운다. 앱이 죽어
 *   장부에 남은 것은 다음 실행 때 지운다.
 * - 보관 파일(고르거나 찍은 영상의 원본 복사본): 코치 화면이 다시 틀기 때문에 두었다가 탈퇴 때
 *   지운다. OS 가 캐시를 치워 이미 사라진 것은 다음 실행 때 장부에서 뺀다.
 *
 * 파일 정리는 최선 노력이다 — 어느 동작도 던지지 않아 올리기와 탈퇴를 막지 않는다.
 * 네이티브 모듈 없이 성립하는 부분만 여기 산다(account-files.ts 가 저장소와 파일 삭제를 넣어 쓴다).
 */
type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export type DeviceFileEntries = { temporary: string[]; kept: string[] };

/**
 * 장부는 계정 자료를 쓸어 내는 'acttub.' 접두사 밖에 둔다. 탈퇴 때 지우지 못한 파일을 다음
 * 실행 때 다시 지우려면 장부가 남아 있어야 한다(밀린 푸시 토큰 삭제와 같은 이유). 남은 파일이
 * 없으면 키도 두지 않는다.
 */
export const DEVICE_FILES_KEY = 'device.accountFiles';

/**
 * 앱이 자기 캐시에 만든 파일만 다룬다. 사진·영상 고르기는 복사본을 file:// 로 주고, content:// 나
 * blob: 처럼 다른 곳을 가리키는 값은 이 앱의 파일이 아니라 적지도 지우지도 않는다.
 */
function isAppFile(uri: unknown): uri is string {
  return typeof uri === 'string' && uri.startsWith('file://');
}

function uriList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(isAppFile) : [];
}

export function parseDeviceFiles(raw: string | null): DeviceFileEntries {
  if (!raw) return { temporary: [], kept: [] };
  try {
    const value = JSON.parse(raw) as { temporary?: unknown; kept?: unknown } | null;
    if (value === null || typeof value !== 'object') return { temporary: [], kept: [] };
    return { temporary: uriList(value.temporary), kept: uriList(value.kept) };
  } catch {
    return { temporary: [], kept: [] };
  }
}

export function createDeviceFileLedger(dependencies: {
  storage: Storage;
  /** 없는 파일이어도 던지지 않는다(멱등). 지우지 못하면 던진다. */
  deleteFile: (uri: string) => Promise<void>;
  fileExists: (uri: string) => Promise<boolean>;
}) {
  const { storage, deleteFile, fileExists } = dependencies;
  let tail: Promise<unknown> = Promise.resolve();

  /** 앞선 동작이 끝난 뒤에 돈다. 장부를 읽고 고쳐 쓰는 사이에 다른 동작이 끼어들지 않는다. */
  function enqueue(task: () => Promise<void>): Promise<void> {
    const run = tail.then(task, task).catch(() => undefined);
    tail = run;
    return run;
  }

  async function read(): Promise<DeviceFileEntries> {
    try {
      return parseDeviceFiles(await storage.getItem(DEVICE_FILES_KEY));
    } catch {
      return { temporary: [], kept: [] };
    }
  }

  async function write(entries: DeviceFileEntries): Promise<void> {
    const temporary = [...new Set(entries.temporary)];
    const kept = [...new Set(entries.kept)].filter((uri) => !temporary.includes(uri));
    if (temporary.length === 0 && kept.length === 0) await storage.removeItem(DEVICE_FILES_KEY);
    else await storage.setItem(DEVICE_FILES_KEY, JSON.stringify({ temporary, kept }));
  }

  /** 지우고, 지우지 못한 것만 돌려준다. */
  async function deleteAll(uris: readonly string[]): Promise<string[]> {
    const failed: string[] = [];
    for (const uri of new Set(uris)) {
      try {
        await deleteFile(uri);
      } catch {
        failed.push(uri);
      }
    }
    return failed;
  }

  return {
    entries: read,

    /** 곧 지울 파일(줄인 사진·영상)을 만들자마자 적는다. */
    trackTemporary(uri: string): Promise<void> {
      if (!isAppFile(uri)) return Promise.resolve();
      return enqueue(async () => {
        const entries = await read();
        await write({ ...entries, temporary: [...entries.temporary, uri] });
      });
    },

    /** 탈퇴 때까지 둘 파일(고르거나 찍은 영상의 원본 복사본)을 적는다. */
    keep(uri: string): Promise<void> {
      if (!isAppFile(uri)) return Promise.resolve();
      return enqueue(async () => {
        const entries = await read();
        await write({ ...entries, kept: [...entries.kept, uri] });
      });
    },

    /** 다 쓴 파일을 지우고 장부에서 뺀다. 지우지 못한 것은 임시 파일로 남아 다음 실행 때 지운다. */
    discard(uris: readonly (string | null | undefined)[]): Promise<void> {
      const targets = uris.filter(isAppFile);
      if (targets.length === 0) return Promise.resolve();
      return enqueue(async () => {
        const failed = await deleteAll(targets);
        const entries = await read();
        await write({
          temporary: [...entries.temporary.filter((uri) => !targets.includes(uri)), ...failed],
          kept: entries.kept.filter((uri) => !targets.includes(uri)),
        });
      });
    },

    /**
     * 앱을 켤 때 부른다. 앞선 실행이 죽어 남긴 임시 파일을 지우고, 이미 사라진 보관 파일을
     * 장부에서 빼 장부가 끝없이 자라지 않게 한다.
     */
    sweep(): Promise<void> {
      return enqueue(async () => {
        const entries = await read();
        const failed = await deleteAll(entries.temporary);
        const kept: string[] = [];
        for (const uri of entries.kept) {
          // 확인하지 못하면 남긴다 — 장부에서 빠진 파일은 탈퇴 때 지울 길이 없다.
          if (await fileExists(uri).catch(() => true)) kept.push(uri);
        }
        await write({ temporary: failed, kept });
      });
    },

    /** 탈퇴 — 장부의 파일을 전부 지운다. 지우지 못한 것은 임시 파일로 남겨 다음 실행 때 지운다. */
    purge(): Promise<void> {
      return enqueue(async () => {
        const entries = await read();
        const failed = await deleteAll([...entries.temporary, ...entries.kept]);
        await write({ temporary: failed, kept: [] });
      });
    },
  };
}

/**
 * 올리기 한 번이 만든 임시 파일을 모았다가, 올리기가 끝나면(성공·실패·취소 모두) 지운다.
 * 파일 정리의 실패는 올리기의 결과를 바꾸지 않는다.
 */
export async function withTemporaryFiles<T>(
  ledger: Pick<ReturnType<typeof createDeviceFileLedger>, 'trackTemporary' | 'discard'>,
  run: (trackTemporary: (uri: string) => Promise<void>) => Promise<T>,
): Promise<T> {
  const uris: string[] = [];
  try {
    return await run(async (uri) => {
      uris.push(uri);
      await ledger.trackTemporary(uri).catch(() => undefined);
    });
  } finally {
    await ledger.discard(uris).catch(() => undefined);
  }
}
