import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import CommunityNewScreen from '@/app/community-new';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';

const mockRouter = { back: jest.fn(), push: jest.fn(), replace: jest.fn() };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));
jest.mock('@/lib/api', () => ({
  api: {
    communityCategories: jest.fn(),
    communityPost: jest.fn(),
    createCommunityPost: jest.fn(),
    updateCommunityPost: jest.fn(),
  },
}));

const createPost = api.createCommunityPost as jest.Mock;
const CATEGORIES = [
  { slug: 'question', name: '질문' },
  { slug: 'audition', name: '오디션 정보' },
  { slug: 'partner', name: '상대역 구함' },
  { slug: 'free', name: '자유' },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  (api.communityCategories as jest.Mock).mockResolvedValue({ categories: CATEGORIES });
});

const submit = () => screen.getByRole('button', { name: '올리기' });
const fill = async (body = '입시 독백 시간이 애매해서 질문드려요.') => {
  await fireEvent.press(await screen.findByRole('radio', { name: '질문' }));
  await fireEvent.changeText(screen.getByLabelText('제목'), '독백 2분 넘으면 감점인가요?');
  await fireEvent.changeText(screen.getByLabelText('내용'), body);
};

test('분류·제목·내용을 다 채워야 올리기가 켜지고, 올리면 그 글로 간다', async () => {
  createPost.mockResolvedValue({ id: 'p9' });
  await render(<CommunityNewScreen />);

  expect(screen.getByText('글쓰기')).toBeOnTheScreen();
  expect(screen.getByText('어떤 글인가요?')).toBeOnTheScreen();
  expect(await screen.findByRole('radio', { name: '상대역 구함' })).toBeOnTheScreen();
  expect(screen.getByText('전화번호·카톡 ID 같은 연락처는 올릴 수 없어요')).toBeOnTheScreen();
  expect(screen.getByText('0 / 2,000')).toBeOnTheScreen();
  expect(submit()).toBeDisabled();

  await fill();
  expect(screen.getByText('21 / 2,000')).toBeOnTheScreen();
  expect(submit()).toBeEnabled();
  await fireEvent.press(submit());

  await waitFor(() =>
    expect(createPost).toHaveBeenCalledWith({
      category_slug: 'question',
      title: '독백 2분 넘으면 감점인가요?',
      body: '입시 독백 시간이 애매해서 질문드려요.',
    }),
  );
  expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/community-post', params: { id: 'p9' } });
  expect(logEvent).toHaveBeenCalledWith('community_post_create', { category: 'question' });
});

test('연락처가 든 글(422 community_contact_info)은 내용 칸 아래에 한 줄로 알린다', async () => {
  createPost.mockRejectedValue(Object.assign(new Error('contact'), { status: 422, code: 'community_contact_info' }));
  await render(<CommunityNewScreen />);
  await fill('같이 맞춰 보실 분 연락 주세요. 카톡 acting_00');
  await fireEvent.press(submit());

  expect(await screen.findByText('연락처는 올릴 수 없어요. 지우고 다시 올려 주세요.')).toBeOnTheScreen();
  expect(screen.queryByText('글을 올리지 못했어요. 잠시 후 다시 올려 주세요.')).not.toBeOnTheScreen();
  // 고치기 시작하면 안내가 사라진다.
  await fireEvent.changeText(screen.getByLabelText('내용'), '같이 맞춰 보실 분 댓글 주세요.');
  expect(screen.queryByText('연락처는 올릴 수 없어요. 지우고 다시 올려 주세요.')).not.toBeOnTheScreen();
});

test('그 밖의 실패는 버튼 위에 한 줄로 알린다', async () => {
  createPost.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));
  await render(<CommunityNewScreen />);
  await fill();
  await fireEvent.press(submit());
  expect(await screen.findByText('글을 올리지 못했어요. 잠시 후 다시 올려 주세요.')).toBeOnTheScreen();
});

test('id 가 있으면 내 글을 불러와 고치고, 분류는 바꾸지 않는다', async () => {
  mockParams = { id: 'p1' };
  (api.communityPost as jest.Mock).mockResolvedValue({
    id: 'p1',
    category_slug: 'free',
    category_name: '자유',
    title: '연습실 구하는 팁',
    body: '조용한 곳을 찾고 있어요',
  });
  (api.updateCommunityPost as jest.Mock).mockResolvedValue({ id: 'p1' });
  await render(<CommunityNewScreen />);

  expect(screen.getByText('글 수정')).toBeOnTheScreen();
  expect(await screen.findByDisplayValue('연습실 구하는 팁')).toBeOnTheScreen();
  expect(screen.getByRole('radio', { name: '자유' })).toBeSelected();
  expect(screen.getByRole('radio', { name: '질문' })).toBeDisabled();

  await fireEvent.changeText(screen.getByLabelText('제목'), '연습실 구하는 팁 있나요');
  await fireEvent.press(screen.getByRole('button', { name: '저장하기' }));
  await waitFor(() =>
    expect(api.updateCommunityPost).toHaveBeenCalledWith('p1', { title: '연습실 구하는 팁 있나요', body: '조용한 곳을 찾고 있어요' }),
  );
  expect(mockRouter.back).toHaveBeenCalled();
});
