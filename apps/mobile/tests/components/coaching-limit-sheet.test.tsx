import { fireEvent, render, screen } from '@testing-library/react-native';

import { CoachingLimitSheet } from '@/components/pro-ui';
import { logEvent } from '@/lib/analytics';

const mockRouter = { push: jest.fn() };

jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));

const modal = () => screen.container.queryAll((node) => typeof node.props.onRequestClose === 'function')[0];
const logs = () => jest.mocked(logEvent).mock.calls.filter(([name]) => name.startsWith('free_limit_'));

beforeEach(() => {
  jest.clearAllMocks();
});

test('뜰 때 free_limit_shown 을 한 번 남기고, 다시 그려져도 더 남기지 않는다(11/27)', async () => {
  const onClose = jest.fn();
  const view = await render(<CoachingLimitSheet visible onClose={onClose} from="talk" />);
  await view.rerender(<CoachingLimitSheet visible onClose={jest.fn()} from="talk" />);
  expect(logs()).toEqual([['free_limit_shown', { kind: 'coaching', from: 'talk' }]]);
});

test('보이지 않으면 아무것도 남기지 않는다', async () => {
  await render(<CoachingLimitSheet visible={false} onClose={jest.fn()} from="upload" />);
  expect(logs()).toEqual([]);
});

test('[Pro 알아보기]는 한 번만 기록하고 코칭 한도 Pro 안내로 간다', async () => {
  const onClose = jest.fn();
  await render(<CoachingLimitSheet visible onClose={onClose} from="upload" />);
  await fireEvent.press(screen.getByText('Pro 알아보기'));
  await fireEvent.press(screen.getByText('Pro 알아보기'));
  expect(logs()).toEqual([
    ['free_limit_shown', { kind: 'coaching', from: 'upload' }],
    ['free_limit_action', { kind: 'coaching', action: 'pro' }],
  ]);
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/pro', params: { from: 'coaching' } });
  expect(onClose).toHaveBeenCalled();
});

test('[내일 할게요]는 later, 다시 뜬 뒤 바깥을 누르면 close 로 남긴다', async () => {
  const onClose = jest.fn();
  const view = await render(<CoachingLimitSheet visible onClose={onClose} from="talk" />);
  await fireEvent.press(screen.getByText('내일 할게요'));
  await view.rerender(<CoachingLimitSheet visible={false} onClose={onClose} from="talk" />);
  await view.rerender(<CoachingLimitSheet visible onClose={onClose} from="talk" />);
  await fireEvent(modal(), 'requestClose');
  expect(logs()).toEqual([
    ['free_limit_shown', { kind: 'coaching', from: 'talk' }],
    ['free_limit_action', { kind: 'coaching', action: 'later' }],
    ['free_limit_shown', { kind: 'coaching', from: 'talk' }],
    ['free_limit_action', { kind: 'coaching', action: 'close' }],
  ]);
  expect(onClose).toHaveBeenCalledTimes(2);
});
