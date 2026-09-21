/**
 * 이 기기에 남은 계정 자료를 지우는 순서(account.withdraw · account.logout).
 *
 * 탈퇴는 서버에서 이메일·이름·로그인 연결을 파기하는데, 기기에도 같은 것들이 남아 있다 —
 * 이름은 SecureStore, 동의 기록·본 적 있음 표시·중단된 분석·대본은 AsyncStorage, 그리고 파일
 * (리딩 녹음, 대본을 읽어 준 음성 합성 결과, 올리려고 줄인 사진·영상, 고르거나 찍은 영상의 복사본).
 * 서버만 지우고 여기를 두면 다음에 켰을 때 떠난 사람의 이름이 그대로 뜨고, 얼굴과 목소리가
 * 기기에 남는다.
 *
 * 네이티브 모듈 없이 성립하는 부분만 여기 산다(local-account-data.ts 가 저장소와 파일 삭제를 넣어 쓴다).
 */
import { resetPracticeState } from './practice.ts';
import { READING_SCRIPTS_KEY, recordingFileUris, resetReadingState } from './reading/store.ts';
import { takeRecordedVideo } from './recorded-video.ts';

type Storage = {
  getAllKeys(): Promise<readonly string[]>;
  getItem(key: string): Promise<string | null>;
  multiRemove(keys: string[]): Promise<void>;
};

export type AccountCacheDependencies = {
  storage: Storage;
  deleteUserName: () => Promise<void>;
};

export type LocalAccountWipeDependencies = AccountCacheDependencies & {
  /** 없는 파일이어도 던지지 않는다(멱등). */
  deleteFile: (uri: string) => Promise<void>;
  /** 장부에 적힌 파일(줄인 사진·영상, 영상 원본 복사본)을 전부 지운다(device-files). */
  purgeDeviceFiles: () => Promise<void>;
  /** 대본을 읽어 준 음성 합성 파일들. 이름이 정해져 있어 캐시 폴더에서 찾는다. */
  listSpeechFiles: () => Promise<string[]>;
  /** 보관함의 기기 복사본 폴더(문서 폴더 archive)와 업로드 대기 파일을 통째로 지운다(practice.record). 없어도 던지지 않는다. */
  purgeLibraryFiles?: () => Promise<void>;
};

/**
 * 키를 하나씩 나열하지 않고 `acttub.` 접두사로 쓸어내는 이유: 저장소를 새로 하나
 * 늘릴 때마다 이 목록에 추가하는 걸 잊으면 조용히 남는다. 지워서 문제가 되는 것은
 * 이 접두사 아래에 두지 않는다.
 */
const KEY_PREFIX = 'acttub.';

/**
 * 로그아웃 때 지우는 계정 캐시 — 이름과, 옛 빌드가 기기에 두던 동의 상태·프로필 사진·소개.
 * 나머지(중단된 분석, 본 적 있음 표시, 대본, 파일)는 남긴다. 배우의 자료는 모두 서버에 있어
 * 기기에서 잃는 것이 없고, 기기 자료를 전부 지우는 것은 탈퇴(wipeLocalAccountData)다.
 */
const ACCOUNT_CACHE_KEYS = [
  'acttub.consentPrefs',
  'acttub.profilePhotoUri',
  'acttub.profileBio',
  'acttub.push.settings',
];

export async function clearAccountCacheData({
  storage,
  deleteUserName,
}: AccountCacheDependencies): Promise<void> {
  resetPracticeState();
  await Promise.allSettled([storage.multiRemove(ACCOUNT_CACHE_KEYS), deleteUserName()]);
}

export async function wipeLocalAccountData({
  storage,
  deleteFile,
  purgeDeviceFiles,
  listSpeechFiles,
  purgeLibraryFiles,
  deleteUserName,
}: LocalAccountWipeDependencies): Promise<void> {
  // 메모리에만 있는 것부터. 실패할 수 없고, 아래가 느려도 화면이 먼저 비워진다.
  resetPracticeState();
  resetReadingState();
  takeRecordedVideo();
  // 파일이 키보다 먼저다 — 녹음 파일의 위치는 대본 저장소에만 적혀 있다.
  const files = [
    ...recordingFileUris(await storage.getItem(READING_SCRIPTS_KEY).catch(() => null)),
    ...(await listSpeechFiles().catch(() => [])),
  ];
  // 하나가 실패해도 나머지는 지운다. 절반이라도 지우는 게 전부 남기는 것보다 낫다.
  await Promise.allSettled([purgeDeviceFiles(), purgeLibraryFiles?.() ?? Promise.resolve(), ...files.map((uri) => deleteFile(uri))]);
  await Promise.allSettled([clearPrefixedKeys(storage), deleteUserName()]);
}

async function clearPrefixedKeys(storage: Storage): Promise<void> {
  const keys = await storage.getAllKeys();
  const mine = keys.filter((key) => key.startsWith(KEY_PREFIX));
  if (mine.length > 0) await storage.multiRemove(mine);
}
