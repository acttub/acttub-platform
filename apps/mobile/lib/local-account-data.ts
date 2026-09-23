import AsyncStorage from '@react-native-async-storage/async-storage';

import { deleteDeviceFile, listSpeechFiles, purgeDeviceFiles, purgeLibraryFiles } from '@/lib/account-files';
import { clearAccountCacheData, wipeLocalAccountData } from '@/lib/local-account-wipe';
import { deleteUserName } from '@/lib/profile';

/**
 * 이 기기에 남은 내 자료를 지운다. 무엇을 어떤 순서로 지우는지는 local-account-wipe 가 정하고,
 * 여기는 저장소와 파일 삭제를 넣어 준다.
 */

/** 로그아웃 — 계정 캐시(이름, 동의 상태)만 지운다. */
export function clearAccountCache(): Promise<void> {
  return clearAccountCacheData({ storage: AsyncStorage, deleteUserName });
}

/** 탈퇴 — 이 기기에 저장된 계정 자료(캐시, 파일, 메모리 상태)를 전부 지운다. */
export function clearLocalAccountData(): Promise<void> {
  return wipeLocalAccountData({
    storage: AsyncStorage,
    deleteFile: deleteDeviceFile,
    purgeDeviceFiles,
    listSpeechFiles,
    purgeLibraryFiles,
    deleteUserName,
  });
}
