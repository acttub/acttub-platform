import mockSafeAreaContext from 'react-native-safe-area-context/jest/mock';

jest.mock('react-native-safe-area-context', () => mockSafeAreaContext);
jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'ko', languageTag: 'ko-KR', regionCode: 'KR' }],
  getCalendars: () => [{ timeZone: 'Asia/Seoul' }],
}));

// 홈·새 연습이 쓰는 「영상 올리는 중」 기록(hooks/use-waiting-upload)이 AsyncStorage 를 불러온다(SOMA-817).
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// 광고 칸(SOMA-876)은 화면마다 서버에 따로 묻는다. 화면 테스트가 광고 요청까지 흉내 내지 않게 비워 두고,
// 칸 자체의 동작은 tests/screens/ad-slot.test.tsx 가 실제 구현으로 본다.
jest.mock('@/components/ad-slot', () => ({ AdSlot: () => null }));

// 앱을 켤 때 홈과 상관없는 호출은 홈이 첫 데이터를 받은 뒤에 나간다(lib/launch-splash afterHomeReady).
// 화면 테스트는 홈이 이미 받은 상태에서 시작한다 — 미루는 동작은 그 화면 테스트에서 따로 본다.
beforeEach(() => {
  require('@/lib/launch-splash').markHomeReady();
  // 리딩 [다음] 두 번 누름 막기 — 화면 테스트는 버튼을 연달아 누르므로 끈다. 막기는 play 화면 테스트 한 곳에서 켜고 본다.
  require('@/lib/reading/next-tap-guard').setNextTapGuardMs(0);
});
