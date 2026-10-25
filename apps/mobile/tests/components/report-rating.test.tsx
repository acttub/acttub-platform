import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { RatingBox, ReportRating } from '@/components/report-rating';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api-request';
import { NOTE_RATING_PENDING_KEY } from '@/lib/practice/note-rating';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
}));
jest.mock('@/lib/api', () => ({ api: { putNoteRating: jest.fn() } }));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));

const putNoteRating = api.putNoteRating as jest.Mock;
const log = logEvent as jest.Mock;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(async () => {
  putNoteRating.mockReset().mockResolvedValue({});
  log.mockReset();
  await AsyncStorage.clear();
});

const good = () => screen.getByRole('button', { name: /도움 됐어요/ });
const bad = () => screen.getByRole('button', { name: /아쉬웠어요/ });
const input = () => screen.queryByPlaceholderText('한 줄 더 남겨주실래요? (선택)');
const sentBodies = () => putNoteRating.mock.calls.map(([id, body]) => [id, { ...body, request_id: typeof body.request_id }]);

test('평가가 없으면 칩만 보이고, 칩을 누르면 그 노트에 저장하고 한 줄 칸을 연다', async () => {
  await render(<ReportRating practiceId="p1" initial={null} />);

  expect(screen.getByText('이 코칭 어땠어요?')).toBeOnTheScreen();
  expect(good()).not.toBeSelected();
  expect(bad()).not.toBeSelected();
  expect(input()).toBeNull();

  await fireEvent.press(good());

  expect(good()).toBeSelected();
  expect(bad()).not.toBeSelected();
  expect(input()).toBeOnTheScreen();
  expect(sentBodies()).toEqual([['p1', { request_id: 'string', rating: 'helpful' }]]);
  expect(log.mock.calls).toEqual([['report_rating_submit', { rating: 'helpful', length: 0, result: 'sent' }]]);
});

test('이미 고른 칩을 다시 누르면 아무것도 보내지 않는다', async () => {
  await render(<ReportRating practiceId="p1" initial={{ rating: 'helpful', comment: null }} />);

  await fireEvent.press(good());

  expect(good()).toBeSelected();
  expect(putNoteRating.mock.calls).toEqual([]);
  await fireEvent.press(bad());
  expect(sentBodies()).toEqual([['p1', { request_id: 'string', rating: 'not_helpful' }]]);
});

test('한 줄을 보내면 공백을 걷어 같은 평가에 덧붙이고 고맙다는 말로 바꾼다', async () => {
  await render(<ReportRating practiceId="p1" initial={null} />);
  await fireEvent.press(bad());

  await fireEvent.changeText(input()!, '  템포가 빨랐어요  ');
  await fireEvent.press(screen.getByRole('button', { name: '보내기' }));

  expect(screen.getByText('고마워요! 다음 코칭에 반영할게요.')).toBeOnTheScreen();
  expect(input()).toBeNull();
  expect(sentBodies()).toEqual([
    ['p1', { request_id: 'string', rating: 'not_helpful' }],
    ['p1', { request_id: 'string', rating: 'not_helpful', comment: '템포가 빨랐어요' }],
  ]);
  expect(log.mock.calls[1]).toEqual(['report_rating_submit', { rating: 'not_helpful', length: 8, result: 'sent' }]);
});

test('빈 한 줄을 보내면 한 줄 없이 평가만 다시 보낸다', async () => {
  await render(<ReportRating practiceId="p1" initial={{ rating: 'helpful', comment: null }} />);

  await fireEvent.changeText(input()!, '   ');
  await fireEvent.press(screen.getByRole('button', { name: '보내기' }));

  expect(screen.getByText('고마워요! 다음 코칭에 반영할게요.')).toBeOnTheScreen();
  expect(sentBodies()).toEqual([['p1', { request_id: 'string', rating: 'helpful' }]]);
});

test('서버에 붙은 한 줄은 칸에 미리 채우고, 칩을 바꿔도 함께 보낸다', async () => {
  await render(<ReportRating practiceId="p1" initial={{ rating: 'not_helpful', comment: '짧아요' }} />);

  expect(bad()).toBeSelected();
  expect(input()).toHaveDisplayValue('짧아요');

  await fireEvent.press(good());

  expect(sentBodies()).toEqual([['p1', { request_id: 'string', rating: 'helpful', comment: '짧아요' }]]);
  expect(log.mock.calls).toEqual([['report_rating_submit', { rating: 'helpful', length: 3, result: 'sent' }]]);
});

test('4xx 로 버려지면 앞 선택으로 되돌린다', async () => {
  putNoteRating.mockRejectedValue(new ApiError(404, 'gone', 'note_not_found'));
  await render(<ReportRating practiceId="p1" initial={null} />);

  await fireEvent.press(good());

  expect(good()).not.toBeSelected();
  expect(input()).toBeNull();
  expect(log.mock.calls).toEqual([['report_rating_submit', { rating: 'helpful', length: 0, result: 'dropped' }]]);
  expect(await AsyncStorage.getItem(NOTE_RATING_PENDING_KEY)).toBeNull();
});

test('보낸 한 줄이 4xx 로 버려지면 고맙다는 말을 걷고 앞 한 줄로 되돌린다', async () => {
  await render(<ReportRating practiceId="p1" initial={{ rating: 'helpful', comment: '좋아요' }} />);
  putNoteRating.mockRejectedValue(new ApiError(422, 'long', 'comment_too_long'));

  await fireEvent.changeText(input()!, '바뀐 한 줄');
  await fireEvent.press(screen.getByRole('button', { name: '보내기' }));

  expect(screen.queryByText('고마워요! 다음 코칭에 반영할게요.')).toBeNull();
  expect(good()).toBeSelected();
  expect(input()).toHaveDisplayValue('바뀐 한 줄');

  await fireEvent.press(bad());
  expect(sentBodies()[1]).toEqual(['p1', { request_id: 'string', rating: 'not_helpful', comment: '좋아요' }]);
});

test('네트워크 실패면 선택을 그대로 두고 기기에 같은 요청을 들고 있는다', async () => {
  putNoteRating.mockRejectedValue(new ApiError(503, 'down'));
  await render(<ReportRating practiceId="p1" initial={null} />);

  await fireEvent.press(good());

  expect(good()).toBeSelected();
  const sentId = putNoteRating.mock.calls[0][1].request_id;
  expect(JSON.parse((await AsyncStorage.getItem(NOTE_RATING_PENDING_KEY))!)).toEqual([
    { practice_id: 'p1', body: { request_id: sentId, rating: 'helpful' } },
  ]);
  expect(log.mock.calls).toEqual([['report_rating_submit', { rating: 'helpful', length: 0, result: 'queued' }]]);
});

test('겹쳐 누른 칩의 늦은 실패는 나중 선택을 되돌리지 않는다', async () => {
  const first = deferred<unknown>();
  putNoteRating.mockReturnValueOnce(first.promise).mockResolvedValueOnce({});
  await render(<ReportRating practiceId="p1" initial={null} />);

  await fireEvent.press(good());
  await fireEvent.press(bad());
  await act(async () => first.reject(new ApiError(404, 'gone', 'note_not_found')));

  expect(bad()).toBeSelected();
  expect(good()).not.toBeSelected();
  expect(input()).toBeOnTheScreen();
});

test('한 줄 칸을 누르면 부른 화면에 알려 칸을 키보드 위로 올리게 한다(10/26 폰: 리딩 끝 화면에서 키보드에 가렸다)', async () => {
  const onInputFocus = jest.fn();
  await render(
    <RatingBox<'good' | 'bad'>
      initial={{ rating: 'good', comment: null }}
      title="이번 리딩 어땠나요?"
      options={[['good', 'thumbs-up', '좋았어요'], ['bad', 'thumbs-down', '아쉬웠어요']]}
      placeholder="한 줄"
      sendLabel="보내기"
      thanks="고마워요"
      commentMax={100}
      save={async () => 'sent'}
      onInputFocus={onInputFocus}
    />,
  );
  await fireEvent(screen.getByPlaceholderText('한 줄'), 'focus');
  expect(onInputFocus).toHaveBeenCalledTimes(1);
});
