import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

import { createDeviceFileLedger, withTemporaryFiles } from './device-files';
import { isSpeechFileName } from './reading/tts/speech-file';

/**
 * 이 기기에 만든 계정 자료 파일(account.withdraw). 무엇을 언제 지우는지는 device-files 가 정하고,
 * 여기는 저장소와 실제 파일 삭제를 넣어 준다.
 */

/** 없는 파일이어도 던지지 않는다. 앱 밖의 파일이라 지울 수 없으면 던진다. */
export function deleteDeviceFile(uri: string): Promise<void> {
  return FileSystem.deleteAsync(uri, { idempotent: true });
}

const ledger = createDeviceFileLedger({
  storage: AsyncStorage,
  deleteFile: deleteDeviceFile,
  fileExists: async (uri) => (await FileSystem.getInfoAsync(uri)).exists,
});

/** 올리려고 만든 임시 파일(줄인 사진·영상). 다 쓰면 discardDeviceFiles 로 지운다. */
export const trackTemporaryDeviceFile = ledger.trackTemporary;
/** 고르거나 찍은 영상의 원본 복사본. 코치 화면이 다시 틀기 때문에 두었다가 탈퇴 때 지운다. */
export const keepDeviceFile = ledger.keep;
export const discardDeviceFiles = ledger.discard;
/** 올리기 한 번이 만든 임시 파일을 모았다가 올리기가 끝나면(성공·실패·취소 모두) 지운다. */
export function withTemporaryDeviceFiles<T>(
  run: (trackTemporary: (uri: string) => Promise<void>) => Promise<T>,
): Promise<T> {
  return withTemporaryFiles(ledger, run);
}
/** 앱을 켤 때 부른다 — 앞선 실행이 죽어 남긴 임시 파일을 지운다. */
export const sweepDeviceFiles = ledger.sweep;
/** 탈퇴 — 장부의 파일을 전부 지운다. */
export const purgeDeviceFiles = ledger.purge;

/** 대본을 읽어 준 음성 합성 파일들(reading/tts/engine 이 캐시 폴더에 만든다). */
export async function listSpeechFiles(): Promise<string[]> {
  const directory = FileSystem.cacheDirectory;
  if (!directory) return [];
  const names = await FileSystem.readDirectoryAsync(directory);
  return names.filter(isSpeechFileName).map((name) => directory + name);
}
