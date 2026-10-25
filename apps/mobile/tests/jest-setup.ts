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
