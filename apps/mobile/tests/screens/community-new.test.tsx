import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';

import CommunityNewScreen from '@/app/community-new';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api-request';

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

jest.mock('@/lib/community-image-picker', () => ({
  pickCommunityImages: jest.fn(),
  uploadPickedImage: jest.fn(),
  discardPickedImages: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const picker = require('@/lib/community-image-picker') as {
  pickCommunityImages: jest.Mock;
  uploadPickedImage: jest.Mock;
  discardPickedImages: jest.Mock;
};
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
      image_ids: [],
    }),
  );
  expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/community-post', params: { id: 'p9' } });
  expect(logEvent).toHaveBeenCalledWith('community_post_create', { category: 'question', images: 0 });
});

test('연락처가 든 글(422 community_contact_info)은 내용 칸 아래에 한 줄로 알린다', async () => {
  // 서버 실제 응답 422 {"detail":"community_contact_info"} 을 api-request 가 바꾼 모양.
  createPost.mockRejectedValue(new ApiError(422, '입력값을 확인해 주세요.', 'community_contact_info', 'community_contact_info'));
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
    expect(api.updateCommunityPost).toHaveBeenCalledWith('p1', { title: '연습실 구하는 팁 있나요', body: '조용한 곳을 찾고 있어요', image_ids: [] }),
  );
  expect(mockRouter.back).toHaveBeenCalled();
});

/** 올리기를 손으로 끝내는 대역 — uri 마다 resolve/reject 를 쥐고 있다. */
function controlledUploads() {
  const pending = new Map<string, { resolve: (id: string) => void; reject: (e: Error) => void }>();
  picker.uploadPickedImage.mockImplementation(
    (uri: string) =>
      new Promise<string>((resolve, reject) => {
        pending.set(uri, { resolve, reject });
      }),
  );
  return pending;
}

test('사진을 여러 장 고르면 바로 올리기 시작하고, 다 올라가야 올리기가 켜지며 id 를 순서대로 싣는다', async () => {
  const pending = controlledUploads();
  picker.pickCommunityImages.mockResolvedValue({ kind: 'picked', uris: ['file:///a.jpg', 'file:///b.jpg'] });
  createPost.mockResolvedValue({ id: 'p9' });
  await render(<CommunityNewScreen />);
  await fill();
  expect(screen.getByRole('button', { name: '사진 더하기, 0/5' })).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('button', { name: '사진 더하기, 0/5' }));
  expect(picker.pickCommunityImages).toHaveBeenCalledWith(5);
  expect(await screen.findAllByText('올리는 중')).toHaveLength(2);
  expect(screen.getByText('사진 2/5')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: '사진 올리는 중…' })).toBeDisabled();
  expect(logEvent).toHaveBeenCalledWith('community_image_add', { count: 2 });

  await act(async () => {
    pending.get('file:///b.jpg')!.resolve('img-b');
    pending.get('file:///a.jpg')!.resolve('img-a');
  });
  expect(screen.queryByText('올리는 중')).not.toBeOnTheScreen();
  await fireEvent.press(submit());
  await waitFor(() => expect(createPost).toHaveBeenCalledWith(expect.objectContaining({ image_ids: ['img-a', 'img-b'] })));
});

test('5장을 넘겨 고르면 앞에서 5장만 받고 나머지 복사본은 지운다', async () => {
  controlledUploads();
  const uris = [1, 2, 3, 4, 5, 6, 7].map((n) => `file:///${n}.jpg`);
  picker.pickCommunityImages.mockResolvedValue({ kind: 'picked', uris });
  await render(<CommunityNewScreen />);
  await fireEvent.press(await screen.findByRole('button', { name: '사진 더하기, 0/5' }));

  expect(await screen.findByText('사진 5/5')).toBeOnTheScreen();
  expect(picker.uploadPickedImage).toHaveBeenCalledTimes(5);
  expect(picker.discardPickedImages).toHaveBeenCalledWith(['file:///6.jpg', 'file:///7.jpg']);
  expect(screen.getByRole('button', { name: '사진 더하기, 5/5' })).toBeDisabled();
});

test('실패한 사진은 빨간 테두리로 남아 올리기를 막고, 눌러 다시 올리거나 x 로 뺄 수 있다', async () => {
  const pending = controlledUploads();
  picker.pickCommunityImages.mockResolvedValue({ kind: 'picked', uris: ['file:///a.jpg'] });
  await render(<CommunityNewScreen />);
  await fill();
  await fireEvent.press(screen.getByRole('button', { name: '사진 더하기, 0/5' }));
  await act(async () => {
    pending.get('file:///a.jpg')!.reject(new Error('put failed'));
  });

  expect(screen.getByTestId('draft-image-failed')).toBeOnTheScreen();
  expect(screen.getByText('올리지 못한 사진이 있어요. 사진을 눌러 다시 올리거나 빼 주세요.')).toBeOnTheScreen();
  expect(submit()).toBeDisabled();

  await fireEvent.press(screen.getByRole('button', { name: '사진 1, 올리지 못했어요. 다시 올리기' }));
  expect(picker.uploadPickedImage).toHaveBeenCalledTimes(2);
  await act(async () => {
    pending.get('file:///a.jpg')!.resolve('img-a');
  });
  expect(screen.getByTestId('draft-image-done')).toBeOnTheScreen();
  expect(submit()).toBeEnabled();

  await fireEvent.press(screen.getByRole('button', { name: '사진 1 빼기' }));
  expect(screen.queryByTestId('draft-image-done')).not.toBeOnTheScreen();
  expect(screen.getByText('사진 0/5')).toBeOnTheScreen();
});

test('사진 접근이 막혀 있으면 설정 열기를 안내한다', async () => {
  picker.pickCommunityImages.mockResolvedValue({ kind: 'blocked' });
  const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
  await render(<CommunityNewScreen />);
  await fireEvent.press(await screen.findByRole('button', { name: '사진 더하기, 0/5' }));

  expect(await screen.findByText('사진 접근이 꺼져 있어요')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '설정 열기' }));
  expect(openSettings).toHaveBeenCalled();
});

test('사진 수 초과(400 too_many_images)는 버튼 위에 알린다', async () => {
  createPost.mockRejectedValue(Object.assign(new Error('too many'), { status: 400, code: 'too_many_images' }));
  await render(<CommunityNewScreen />);
  await fill();
  await fireEvent.press(submit());
  expect(await screen.findByText('사진은 5장까지 붙일 수 있어요.')).toBeOnTheScreen();
});

test('고치는 글은 기존 사진을 보여 주고, 빼면 남은 사진 id 만 보낸다', async () => {
  mockParams = { id: 'p1' };
  (api.communityPost as jest.Mock).mockResolvedValue({
    id: 'p1',
    category_slug: 'free',
    category_name: '자유',
    title: '연습실 구하는 팁',
    body: '조용한 곳을 찾고 있어요',
    images: [
      { id: 'i1', url: 'https://cdn.test/1.jpg' },
      { id: 'i2', url: 'https://cdn.test/2.jpg' },
    ],
  });
  (api.updateCommunityPost as jest.Mock).mockResolvedValue({ id: 'p1' });
  await render(<CommunityNewScreen />);

  expect(await screen.findByText('사진 2/5')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '사진 1 빼기' }));
  await fireEvent.press(screen.getByRole('button', { name: '저장하기' }));
  await waitFor(() =>
    expect(api.updateCommunityPost).toHaveBeenCalledWith('p1', { title: '연습실 구하는 팁', body: '조용한 곳을 찾고 있어요', image_ids: ['i2'] }),
  );
});
