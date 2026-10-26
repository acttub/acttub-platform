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
