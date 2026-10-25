import { render, screen } from '@testing-library/react-native';

import AnalyzingScreen from '@/app/analyzing';

/**
 * 옛 분석 화면 주소(/analyzing)는 남겨 둔 딥링크·복구 기록을 위한 얇은 넘김이다(SOMA-778). 기다림은 코치 화면 안에서 한다 —
 * 조회·푸시·그만두기·다시 시도는 tests/screens/coach-waiting.test.tsx 가 본다.
 */
let mockParams: Record<string, unknown> = {};
jest.mock('expo-router', () => {
  const { Text } = require('react-native');
  return {
    useLocalSearchParams: () => mockParams,
    Redirect: ({ href }: { href: unknown }) => <Text>{JSON.stringify(href)}</Text>,
  };
});

test('받은 회차 id·복구 키를 그대로 들고 액티 화면으로 넘긴다', async () => {
  mockParams = { practiceId: 'p1', recoveryKey: 'k1' };
  await render(<AnalyzingScreen />);
  expect(screen.getByText(JSON.stringify({ pathname: '/coach', params: { practiceId: 'p1', recoveryKey: 'k1' } }))).toBeOnTheScreen();
});

test('개발용 미리보기 인자도 그대로 넘긴다', async () => {
  mockParams = { preview: '1' };
  await render(<AnalyzingScreen />);
  expect(screen.getByText(JSON.stringify({ pathname: '/coach', params: { preview: '1' } }))).toBeOnTheScreen();
});
