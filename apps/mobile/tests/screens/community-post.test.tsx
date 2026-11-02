import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import CommunityPostScreen from '@/app/community-post';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import type { CommunityComment, CommunityPost } from '@/lib/community';

const mockRouter = { back: jest.fn(), push: jest.fn(), replace: jest.fn() };
jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return {
    useRouter: () => mockRouter,
    useLocalSearchParams: () => ({ id: 'p1' }),
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));
jest.mock('@/lib/api', () => ({
  api: {
    communityPost: jest.fn(),
    communityComments: jest.fn(),
    likeCommunityPost: jest.fn(),
    createCommunityComment: jest.fn(),
    deleteCommunityPost: jest.fn(),
    deleteCommunityComment: jest.fn(),
    reportCommunityContent: jest.fn(),
    blockCommunityUser: jest.fn(),
  },
}));

const communityPost = api.communityPost as jest.Mock;
const communityComments = api.communityComments as jest.Mock;

const post = (over: Partial<CommunityPost> = {}): CommunityPost => ({
  id: 'p1',
  category_slug: 'question',
  category_name: '질문',
  title: '독백 2분 넘으면 감점인가요?',
  body: '입시 독백 시간이 애매해서 질문드려요.',
  like_count: 3,
  comment_count: 2,
  liked_by_me: false,
  author_name: '하늘',
  author: { id: 'u-sky' },
  is_mine: false,
  status: 'visible',
  created_at: new Date(Date.now() - 12 * 60_000).toISOString(),
  ...over,
});
const comment = (over: Partial<CommunityComment> = {}): CommunityComment => ({
  id: 'c1',
  post_id: 'p1',
  body: '저는 2분은 지키는 편이 안전했어요.',
  author_name: '달빛',
  author: { id: 'u-moon' },
  is_mine: false,
  created_at: new Date(Date.now() - 10 * 60_000).toISOString(),
  ...over,
});

const menuLabels = () =>
  within(screen.getByTestId('anchored-menu'))
    .getAllByRole('button')
    .map((b) => b.props.accessibilityLabel);

beforeEach(() => {
  jest.clearAllMocks();
  communityComments.mockResolvedValue({
    comments: [comment(), comment({ id: 'c2', body: '감사해요!', author_name: '하늘', author: { id: 'u-sky' } })],
    next_cursor: null,
  });
});

test('글 본문·작성자·좋아요·댓글 수와 댓글, 글쓴이 배지를 그린다', async () => {
  communityPost.mockResolvedValue(post());
  await render(<CommunityPostScreen />);

  expect(await screen.findByText('독백 2분 넘으면 감점인가요?')).toBeOnTheScreen();
  expect(screen.getByText('게시판')).toBeOnTheScreen();
  expect(screen.getByText('질문')).toBeOnTheScreen();
  expect(screen.getByText('좋아요 3')).toBeOnTheScreen();
  expect(screen.getByText('댓글 2')).toBeOnTheScreen();
  expect(screen.getByText('달빛')).toBeOnTheScreen();
  // 글쓴이가 단 댓글에만 배지가 붙는다.
  expect(screen.getAllByText('글쓴이')).toHaveLength(1);
  // 좋아요를 누르지 않았으면 채운 하트가 없다.
  expect(screen.queryByTestId('liked-heart')).not.toBeOnTheScreen();
  expect(logEvent).toHaveBeenCalledWith('community_post_open', { id: 'p1', category: 'question' });
});

test('이름이 없으면 배우로 보여준다', async () => {
  communityPost.mockResolvedValue(post({ author_name: null }));
  communityComments.mockResolvedValue({ comments: [], next_cursor: null });
  await render(<CommunityPostScreen />);
  expect(await screen.findByText('배우')).toBeOnTheScreen();
  expect(screen.getByText('첫 댓글을 남겨 보세요.')).toBeOnTheScreen();
});

test('남의 글 ⋯ 메뉴는 신고하기·이 사람 차단하기이고, 차단은 확인 뒤 목록으로 돌아간다', async () => {
  communityPost.mockResolvedValue(post());
  (api.blockCommunityUser as jest.Mock).mockResolvedValue(undefined);
  await render(<CommunityPostScreen />);
  await fireEvent.press(await screen.findByRole('button', { name: '글 메뉴' }));

  expect(menuLabels()).toEqual(['신고하기', '이 사람 차단하기']);
  await fireEvent.press(screen.getByRole('button', { name: '이 사람 차단하기' }));
  expect(await screen.findByText('이 사람을 차단할까요?')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '차단하기' }));

  await waitFor(() => expect(api.blockCommunityUser).toHaveBeenCalledWith('u-sky'));
  expect(mockRouter.back).toHaveBeenCalled();
  expect(logEvent).toHaveBeenCalledWith('community_block', { target: 'post' });
});

test('신고는 사유를 골라 보내고 접수 안내를 띄운다', async () => {
  communityPost.mockResolvedValue(post());
  (api.reportCommunityContent as jest.Mock).mockResolvedValue(undefined);
  await render(<CommunityPostScreen />);
  await fireEvent.press(await screen.findByRole('button', { name: '글 메뉴' }));
  await fireEvent.press(screen.getByRole('button', { name: '신고하기' }));

  expect(await screen.findByText('이 글을 신고할까요?')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('radio', { name: '스팸·광고' }));
  await fireEvent.press(screen.getByRole('button', { name: '신고하기' }));

  await waitFor(() =>
    expect(api.reportCommunityContent).toHaveBeenCalledWith({ target_type: 'post', target_id: 'p1', reason: 'spam' }),
  );
  expect(await screen.findByText('신고를 접수했어요')).toBeOnTheScreen();
});

test('내 글 ⋯ 메뉴는 수정하기·삭제(맨 아래)이고, 삭제는 확인 뒤 지우고 돌아간다', async () => {
  communityPost.mockResolvedValue(post({ is_mine: true }));
  (api.deleteCommunityPost as jest.Mock).mockResolvedValue(undefined);
  await render(<CommunityPostScreen />);
  await fireEvent.press(await screen.findByRole('button', { name: '글 메뉴' }));

  expect(menuLabels()).toEqual(['수정하기', '삭제']);
  await fireEvent.press(screen.getByRole('button', { name: '수정하기' }));
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/community-new', params: { id: 'p1' } });

  await fireEvent.press(screen.getByRole('button', { name: '글 메뉴' }));
  await fireEvent.press(screen.getByRole('button', { name: '삭제' }));
  expect(await screen.findByText('이 글을 삭제할까요?')).toBeOnTheScreen();
  await fireEvent.press(screen.getAllByRole('button', { name: '삭제' }).at(-1)!);
  await waitFor(() => expect(api.deleteCommunityPost).toHaveBeenCalledWith('p1'));
  expect(mockRouter.back).toHaveBeenCalled();
});

test('신고로 가려진 내 글에는 다른 사람에게 보이지 않는다는 안내가 있다', async () => {
  communityPost.mockResolvedValue(post({ is_mine: true, status: 'hidden' }));
  await render(<CommunityPostScreen />);
  expect(await screen.findByText('신고가 접수되어 다른 사람에게는 보이지 않아요')).toBeOnTheScreen();
});

test('좋아요를 누르면 바로 채운 하트가 되고 서버 수로 맞춘다', async () => {
  communityPost.mockResolvedValue(post());
  (api.likeCommunityPost as jest.Mock).mockResolvedValue({ like_count: 4, liked_by_me: true });
  await render(<CommunityPostScreen />);
  await fireEvent.press(await screen.findByRole('button', { name: '좋아요 3' }));

  expect(api.likeCommunityPost).toHaveBeenCalledWith('p1', true);
  expect(await screen.findByTestId('liked-heart')).toBeOnTheScreen();
  expect(await screen.findByText('좋아요 4')).toBeOnTheScreen();
});

test('댓글은 적어야 등록이 켜지고, 올리면 목록 끝에 붙는다', async () => {
  communityPost.mockResolvedValue(post());
  (api.createCommunityComment as jest.Mock).mockResolvedValue(comment({ id: 'c3', body: '저도 궁금해요', author_name: '나', is_mine: true }));
  await render(<CommunityPostScreen />);
  const send = await screen.findByRole('button', { name: '등록' });
  expect(send).toBeDisabled();

  await fireEvent.changeText(screen.getByPlaceholderText('댓글을 남겨 주세요'), '저도 궁금해요');
  expect(screen.getByRole('button', { name: '등록' })).toBeEnabled();
  await fireEvent.press(screen.getByRole('button', { name: '등록' }));

  await waitFor(() => expect(api.createCommunityComment).toHaveBeenCalledWith('p1', { body: '저도 궁금해요' }));
  expect(await screen.findByText('저도 궁금해요')).toBeOnTheScreen();
  expect(screen.getByText('댓글 3')).toBeOnTheScreen();
  expect(logEvent).toHaveBeenCalledWith('community_comment_create', { post_id: 'p1' });
});

test('지워진 글은 상태 화면과 목록으로 버튼을 보인다', async () => {
  communityPost.mockRejectedValue(Object.assign(new Error('gone'), { status: 404 }));
  await render(<CommunityPostScreen />);
  expect(await screen.findByText('지워졌거나 볼 수 없는 글이에요')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '목록으로' }));
  expect(mockRouter.back).toHaveBeenCalled();
});

test('내 댓글 ⋯ 은 삭제 하나이고, 확인하면 지우고 댓글 수를 줄인다', async () => {
  communityPost.mockResolvedValue(post());
  communityComments.mockResolvedValue({ comments: [comment({ id: 'mine', body: '제 댓글', is_mine: true })], next_cursor: null });
  (api.deleteCommunityComment as jest.Mock).mockResolvedValue(undefined);
  await render(<CommunityPostScreen />);
  await fireEvent.press(await screen.findByRole('button', { name: '댓글 메뉴' }));

  expect(menuLabels()).toEqual(['삭제']);
  await fireEvent.press(screen.getByRole('button', { name: '삭제' }));
  expect(await screen.findByText('이 댓글을 삭제할까요?')).toBeOnTheScreen();
  await fireEvent.press(screen.getAllByRole('button', { name: '삭제' }).at(-1)!);

  await waitFor(() => expect(api.deleteCommunityComment).toHaveBeenCalledWith('mine'));
  expect(screen.queryByText('제 댓글')).not.toBeOnTheScreen();
  expect(screen.getByText('댓글 1')).toBeOnTheScreen();
});

test('남의 댓글을 기타 사유와 설명으로 신고하고, 이미 신고했으면 그렇게 알린다', async () => {
  communityPost.mockResolvedValue(post());
  (api.reportCommunityContent as jest.Mock).mockRejectedValue(Object.assign(new Error('dup'), { status: 409 }));
  await render(<CommunityPostScreen />);
  await fireEvent.press((await screen.findAllByRole('button', { name: '댓글 메뉴' }))[0]);
  expect(menuLabels()).toEqual(['신고하기', '이 사람 차단하기']);
  await fireEvent.press(screen.getByRole('button', { name: '신고하기' }));

  expect(await screen.findByText('이 댓글을 신고할까요?')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('radio', { name: '기타' }));
  await fireEvent.changeText(screen.getByLabelText('무엇이 문제인지 알려 주세요 (선택)'), '  반복 도배  ');
  expect(screen.getByText('9 / 500')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '신고하기' }));

  await waitFor(() =>
    expect(api.reportCommunityContent).toHaveBeenCalledWith({ target_type: 'comment', target_id: 'c1', reason: 'other', detail: '반복 도배' }),
  );
  expect(await screen.findByText('이미 신고했어요.')).toBeOnTheScreen();
});

test('못 불러오면 다시 시도로 다시 받는다', async () => {
  communityPost.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(post());
  await render(<CommunityPostScreen />);
  expect(await screen.findByText('글을 불러오지 못했어요')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '다시 시도' }));
  expect(await screen.findByText('독백 2분 넘으면 감점인가요?')).toBeOnTheScreen();
});

test('댓글이 더 있으면 더 보기로 이어 받는다', async () => {
  communityPost.mockResolvedValue(post());
  communityComments
    .mockResolvedValueOnce({ comments: [comment()], next_cursor: 'n1' })
    .mockResolvedValueOnce({ comments: [comment({ id: 'c9', body: '다음 쪽 댓글' })], next_cursor: null });
  await render(<CommunityPostScreen />);
  await fireEvent.press(await screen.findByRole('button', { name: '댓글 더 보기' }));
  expect(await screen.findByText('다음 쪽 댓글')).toBeOnTheScreen();
  expect(communityComments).toHaveBeenLastCalledWith('p1', 'n1');
  expect(screen.queryByRole('button', { name: '댓글 더 보기' })).not.toBeOnTheScreen();
});

test('사진은 본문 아래에 차례대로 놓이고, 누르면 전체 화면으로 본다', async () => {
  communityPost.mockResolvedValue(
    post({
      images: [
        { id: 'i1', url: 'https://cdn.test/1.jpg' },
        { id: 'i2', url: 'https://cdn.test/2.jpg' },
      ],
    }),
  );
  await render(<CommunityPostScreen />);
  expect(await screen.findAllByTestId('post-image')).toHaveLength(2);
  expect(screen.queryByTestId('viewer-image')).not.toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('imagebutton', { name: '사진 2, 크게 보기' }));
  // 누른 사진부터 연다.
  const shown = await screen.findAllByTestId('viewer-image');
  expect(shown[0].props.source).toEqual([{ uri: 'https://cdn.test/2.jpg' }]);
  expect(logEvent).toHaveBeenCalledWith('community_image_view', { index: 1 });
  await fireEvent.press(screen.getByRole('button', { name: '닫기' }));
  await waitFor(() => expect(screen.queryByTestId('viewer-image')).not.toBeOnTheScreen());
});

test('게스트(403 member_only)는 회원 전용 안내와 목록으로 버튼을 본다', async () => {
  communityPost.mockRejectedValue(Object.assign(new Error('member'), { status: 403, code: 'member_only' }));
  await render(<CommunityPostScreen />);
  expect(await screen.findByText('게시판은 회원만 이용할 수 있어요.')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: '다시 시도' })).not.toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '목록으로' }));
  expect(mockRouter.back).toHaveBeenCalled();
});
