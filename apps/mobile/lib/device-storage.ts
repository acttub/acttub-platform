/** 기기 저장소(AsyncStorage)에서 이 앱이 쓰는 부분. */
export type DeviceStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

/**
 * AsyncStorage — 무설치 node 테스트에서도 모듈을 읽을 수 있게 쓰는 순간 require 한다(테스트는 전역 require 로 기억 속 저장소를 넣는다).
 * 못 읽거나 못 쓸 때의 기본값은 쓰는 곳마다 다르므로 여기서 감싸지 않는다.
 */
export function deviceStorage(): DeviceStorage {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@react-native-async-storage/async-storage').default as DeviceStorage;
}
