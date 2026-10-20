/**
 * 기기 저장소 기본값 시험용. lib 의 몇 모듈은 무설치 node 에서도 읽히도록 AsyncStorage 를 함수 안에서 require 한다.
 * 앱(Metro)의 require 자리를 전역 require 로 채워 기억 속 저장소를 넣는다. broken 이면 모든 호출이 던진다.
 */
export function installGlobalStorage() {
  const state = { items: new Map(), broken: false };
  const call = (fn) => async (...args) => {
    if (state.broken) throw new Error('storage unavailable');
    return fn(...args);
  };
  const storage = {
    getItem: call(async (key) => state.items.get(key) ?? null),
    setItem: call(async (key, value) => {
      state.items.set(key, value);
    }),
    removeItem: call(async (key) => {
      state.items.delete(key);
    }),
  };
  globalThis.require = (id) => {
    if (id === '@react-native-async-storage/async-storage') return { default: storage };
    throw new Error(`unexpected require: ${id}`);
  };
  return state;
}
