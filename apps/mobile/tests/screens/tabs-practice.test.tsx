import { render, screen } from '@testing-library/react-native';

import PracticeTab from '@/app/(tabs)/practice';

let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams }));
jest.mock('@/components/practice/reading-pane', () => {
  const { Text } = require('react-native');
  return { __esModule: true, default: ({ focusCoaching }: { focusCoaching?: boolean }) => <Text>{`page:${focusCoaching ? 'coaching' : 'top'}`}</Text> };
});

test('연습 탭은 한 페이지다 — 주소에 mode 가 없거나 reading 이면 맨 위부터', async () => {
  mockParams = {};
  await render(<PracticeTab />);
  expect(screen.getByText('page:top')).toBeOnTheScreen();
  mockParams = { mode: 'reading' };
  await render(<PracticeTab />);
  expect(screen.getByText('page:top')).toBeOnTheScreen();
});

test('예전 코칭 쪽 주소(/practice?mode=coaching)로 오면 같은 페이지의 코칭 구역으로 내려 준다', async () => {
  mockParams = { mode: 'coaching' };
  await render(<PracticeTab />);
  expect(screen.getByText('page:coaching')).toBeOnTheScreen();
});
