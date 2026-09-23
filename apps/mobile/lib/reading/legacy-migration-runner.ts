import AsyncStorage from '@react-native-async-storage/async-storage';

import { deleteDeviceFile } from '@/lib/account-files';
import { api } from '@/lib/api';
import {
  dismissLegacyNotice,
  migrateLegacyScripts,
  readLegacyNotice,
  type LegacyMigrationResult,
  type LegacyNotice,
} from '@/lib/reading/legacy-migration';
import { newRequestId } from '@/lib/reading/store';

/**
 * 옛 대본 옮기기의 실행 배선(reading.script). 무엇을 어떤 순서로 옮기는지는 legacy-migration 이 정하고,
 * 여기는 저장소·API·파일 삭제를 넣어 준다.
 *
 * 로그인·게이트를 지난 뒤 앱 실행마다 한 번 시도한다. 실패한 대본은 기기에 남아 다음 실행에 다시 한다.
 * 이 앱은 기기당 계정 하나를 전제로 옛 대본을 처음 게이트를 지난 계정으로 옮긴다.
 */
let started = false;
let running: Promise<LegacyMigrationResult> | null = null;

export function runLegacyScriptMigrationOnce(): Promise<LegacyMigrationResult> | null {
  if (started) return running;
  started = true;
  running = migrateLegacyScripts({
    storage: AsyncStorage,
    createScript: (body) => api.createReadingScript(body),
    setMemorization: (lineId, status) => api.setLineMemorization(lineId, status),
    deleteFile: deleteDeviceFile,
    newRequestId,
  }).catch(() => ({ moved: 0, memorized: 0, limited: 0, failed: 0 }));
  return running;
}

/** 옮긴 결과 안내(한 번). 대본 탭이 읽고 닫는다. */
export function readLegacyScriptNotice(): Promise<LegacyNotice | null> {
  return readLegacyNotice(AsyncStorage);
}

export function dismissLegacyScriptNotice(): Promise<void> {
  return dismissLegacyNotice(AsyncStorage);
}
