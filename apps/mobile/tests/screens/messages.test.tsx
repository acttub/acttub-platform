import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import ConversationScreen from '@/app/messages/[id]';
import MessagesScreen from '@/app/messages/index';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import type { DirectConversation, DirectMessage } from '@/lib/messages';

const mockRouter = { back: jest.fn(), push: jest.fn(), replace: jest.fn() };
let mockParams: Record<string, string> = { id: 'c1' };
jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return {
    useRouter: () => mockRouter,
    useLocalSearchParams: () => mockParams,
    useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect]),
  };
});
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));
jest.mock('@/lib/api', () => ({
  api: {
    listConversations: jest.fn(),
    startDirectConversation: jest.fn(),
    conversation: jest.fn(),
    listMessages: jest.fn(),
    sendMessage: jest.fn(),
    markConversationRead: jest.fn(),
    reportConversation: jest.fn(),
    blockCommunityUser: jest.fn(),
  },
}));

const conversation = (over: Partial<DirectConversation> = {}): DirectConversation => ({
  id: 'c1',
  partner: { id: 'u-sky', name: '하늘', photo_url: null, withdrawn: false },
  origin_post: { id: 'p1', title: '상대역 구해요' },
  can_send: true,
  unavailable_reason: null,
  created_at: '2026-11-28T00:00:00Z',
  last_message_at: '2026-11-28T00:01:00Z',
  ...over,
});
const message = (id: string, body: string, mine: boolean, second: number): DirectMessage => ({
  id,
  conversation_id: 'c1',
  body,
  mine,
  created_at: `2026-11-28T00:00:${String(second).padStart(2, '0')}Z`,
});

const mocked = (fn: unknown) => fn as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { id: 'c1' };
  mocked(api.conversation).mockResolvedValue(conversation());
  mocked(api.listMessages).mockResolvedValue({
    // 서버는 최근 것부터 준다.
    messages: [message('m2', '네, 좋아요', true, 2), message('m1', '같이 읽어요', false, 1)],
    next_cursor: null,
  });
  mocked(api.markConversationRead).mockResolvedValue(undefined);
});

describe('메시지 목록', () => {
  test('상대 이름·미리보기·안 읽은 배지를 그리고, 누르면 그 대화로 간다', async () => {
    mocked(api.listConversations).mockResolvedValue({
      conversations: [
        {
          id: 'c1',
          partner: { id: 'u-sky', name: '하늘', photo_url: null, withdrawn: false },
          last_message: { preview: '같이 읽어요', mine: false, created_at: new Date().toISOString() },
          unread_count: 3,
          last_message_at: new Date().toISOString(),
        },
      ],
      next_cursor: null,
    });
    await render(<MessagesScreen />);
    expect(await screen.findByText('하늘')).toBeOnTheScreen();
    expect(screen.getByText('같이 읽어요')).toBeOnTheScreen();
    expect(screen.getByText('3')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: '하늘, 안 읽은 메시지 3개' }));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/messages/[id]', params: { id: 'c1' } });
  });

  test('대화가 없으면 빈 상태 문구를 보인다', async () => {
    mocked(api.listConversations).mockResolvedValue({ conversations: [], next_cursor: null });
    await render(<MessagesScreen />);
    expect(await screen.findByText('아직 주고받은 메시지가 없어요')).toBeOnTheScreen();
    expect(screen.getByText('게시판 글이나 댓글에서 작성자 이름을 누르면 메시지를 보낼 수 있어요.')).toBeOnTheScreen();
  });

  test('못 불러오면 다시 시도로 다시 받는다', async () => {
    mocked(api.listConversations).mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ conversations: [], next_cursor: null });
    await render(<MessagesScreen />);
    expect(await screen.findByText('메시지를 불러오지 못했어요')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByText('아직 주고받은 메시지가 없어요')).toBeOnTheScreen();
  });
});

describe('대화방', () => {
  test('시작 글 한 줄과 말풍선을 오래된 것부터 그리고, 읽음을 남긴다', async () => {
    await render(<ConversationScreen />);
    expect(await screen.findByText('하늘')).toBeOnTheScreen();
    expect(screen.getByText('「상대역 구해요」에서 시작한 대화')).toBeOnTheScreen();
    const texts = screen.getAllByText(/같이 읽어요|네, 좋아요/).map((node) => node.props.children);
    expect(texts).toEqual(['같이 읽어요', '네, 좋아요']);
    expect(api.markConversationRead).toHaveBeenCalledWith('c1');

    await fireEvent.press(screen.getByRole('link', { name: '대화를 시작한 글 보기: 상대역 구해요' }));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/community-post', params: { id: 'p1' } });
  });

  test('글에서 오면 대화를 열고(dm_start) 그 대화를 그린다', async () => {
    mockParams = { id: 'new', userId: 'u-sky', postId: 'p1', from: 'comment' };
    mocked(api.startDirectConversation).mockResolvedValue(conversation());
    await render(<ConversationScreen />);
    expect(await screen.findByText('같이 읽어요')).toBeOnTheScreen();
    expect(api.startDirectConversation).toHaveBeenCalledWith({ user_id: 'u-sky', post_id: 'p1' });
    expect(logEvent).toHaveBeenCalledWith('dm_start', { from: 'comment' });
  });

  test('차단 관계면 대화를 열지 못하고 안내만 보인다', async () => {
    mockParams = { id: 'new', userId: 'u-sky', postId: 'p1', from: 'post' };
    mocked(api.startDirectConversation).mockRejectedValue(Object.assign(new Error('blocked'), { status: 403, code: 'message_blocked' }));
    await render(<ConversationScreen />);
    expect(await screen.findByText('차단한 사이라 메시지를 주고받을 수 없어요.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: '목록으로' }));
    expect(mockRouter.back).toHaveBeenCalled();
  });

  test('보내면 흐린 말풍선이 먼저 뜨고 서버 답으로 바뀐다(dm_send)', async () => {
    let release: (m: DirectMessage) => void = () => undefined;
    mocked(api.sendMessage).mockImplementationOnce(() => new Promise((r) => (release = r)));
    await render(<ConversationScreen />);
    await fireEvent.changeText(await screen.findByPlaceholderText('메시지를 적어 주세요'), '  대본 보내 드릴게요  ');
    await fireEvent.press(screen.getByRole('button', { name: '보내기' }));

    expect(screen.getByTestId('dm-pending-sending')).toBeOnTheScreen();
    expect(screen.getByText('대본 보내 드릴게요')).toBeOnTheScreen();
    const [conversationId, body] = mocked(api.sendMessage).mock.calls[0];
    expect(conversationId).toBe('c1');
    expect(body.body).toBe('대본 보내 드릴게요');
    expect(typeof body.request_id).toBe('string');

    await act(async () => release(message('m3', '대본 보내 드릴게요', true, 3)));
    expect(screen.queryByTestId('dm-pending-sending')).not.toBeOnTheScreen();
    expect(screen.getByTestId('dm-message-m3')).toBeOnTheScreen();
    expect(logEvent).toHaveBeenCalledWith('dm_send');
  });

  test('실패하면 「다시 보내기」가 붙고, 누르면 같은 요청 id 로 다시 보낸다', async () => {
    mocked(api.sendMessage)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(message('m3', '안녕하세요', true, 3));
    await render(<ConversationScreen />);
    await fireEvent.changeText(await screen.findByPlaceholderText('메시지를 적어 주세요'), '안녕하세요');
    await fireEvent.press(screen.getByRole('button', { name: '보내기' }));

    const retry = await screen.findByRole('button', { name: '다시 보내기' });
    expect(screen.getByTestId('dm-pending-failed')).toBeOnTheScreen();
    await fireEvent.press(retry);
    await waitFor(() => expect(api.sendMessage).toHaveBeenCalledTimes(2));
    const first = mocked(api.sendMessage).mock.calls[0][1];
    const second = mocked(api.sendMessage).mock.calls[1][1];
    expect(second.request_id).toBe(first.request_id);
    expect(await screen.findByTestId('dm-message-m3')).toBeOnTheScreen();
  });

  test('하루 한도에 닿으면 입력칸 위에 알린다', async () => {
    mocked(api.sendMessage).mockRejectedValue(Object.assign(new Error('limit'), { status: 429, code: 'daily_message_limit' }));
    await render(<ConversationScreen />);
    await fireEvent.changeText(await screen.findByPlaceholderText('메시지를 적어 주세요'), '하나 더');
    await fireEvent.press(screen.getByRole('button', { name: '보내기' }));
    expect(await screen.findByText('오늘은 메시지를 더 보낼 수 없어요. 내일 다시 보내 주세요.')).toBeOnTheScreen();
  });

  test('상대가 탈퇴했으면 입력칸 대신 안내를 둔다', async () => {
    mocked(api.conversation).mockResolvedValue(
      conversation({ partner: { id: 'u-sky', name: '탈퇴한 사용자', photo_url: null, withdrawn: true }, can_send: false, unavailable_reason: 'partner_unavailable' }),
    );
    await render(<ConversationScreen />);
    expect(await screen.findByText('탈퇴한 배우라 메시지를 보낼 수 없어요.')).toBeOnTheScreen();
    expect(screen.queryByPlaceholderText('메시지를 적어 주세요')).not.toBeOnTheScreen();
  });

  test('⋯ 메뉴는 신고하기·이 사람 차단하기이고, 차단은 게시판 차단으로 건다(dm_block)', async () => {
    mocked(api.blockCommunityUser).mockResolvedValue(undefined);
    await render(<ConversationScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: '대화 메뉴' }));
    const labels = within(screen.getByTestId('anchored-menu'))
      .getAllByRole('button')
      .map((b) => b.props.accessibilityLabel);
    expect(labels).toEqual(['신고하기', '이 사람 차단하기']);
    await fireEvent.press(screen.getByRole('button', { name: '이 사람 차단하기' }));
    expect(await screen.findByText('이 사람을 차단할까요?')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: '차단하기' }));
    await waitFor(() => expect(api.blockCommunityUser).toHaveBeenCalledWith('u-sky'));
    expect(logEvent).toHaveBeenCalledWith('dm_block');
  });

  test('신고는 게시판 신고 화면을 그대로 쓰고 대화를 신고한다(dm_report)', async () => {
    mocked(api.reportConversation).mockResolvedValue(undefined);
    await render(<ConversationScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: '대화 메뉴' }));
    await fireEvent.press(screen.getByRole('button', { name: '신고하기' }));
    expect(await screen.findByText('이 대화를 신고할까요?')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('radio', { name: '욕설·비하·괴롭힘' }));
    await fireEvent.press(screen.getByRole('button', { name: '신고하기' }));
    await waitFor(() => expect(api.reportConversation).toHaveBeenCalledWith('c1', { reason: 'abuse' }));
    expect(logEvent).toHaveBeenCalledWith('dm_report', { reason: 'abuse' });
    expect(await screen.findByText('신고를 접수했어요')).toBeOnTheScreen();
  });

  test('화면에 있는 동안 몇 초마다 새 메시지를 받아 붙이고 읽음을 남긴다', async () => {
    jest.useFakeTimers();
    try {
      await render(<ConversationScreen />);
      expect(await screen.findByText('같이 읽어요')).toBeOnTheScreen();
      mocked(api.markConversationRead).mockClear();
      mocked(api.listMessages).mockResolvedValue({
        messages: [message('m4', '방금 온 메시지', false, 4), message('m2', '네, 좋아요', true, 2), message('m1', '같이 읽어요', false, 1)],
        next_cursor: null,
      });
      await act(async () => {
        jest.advanceTimersByTime(5_000);
      });
      expect(await screen.findByText('방금 온 메시지')).toBeOnTheScreen();
      expect(api.markConversationRead).toHaveBeenCalledWith('c1');
    } finally {
      jest.useRealTimers();
    }
  });
});
