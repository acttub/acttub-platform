import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { ReadingRating } from '@/components/reading-rating';
import { RatingBox, ReportRating } from '@/components/report-rating';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api-request';
import { NOTE_RATING_PENDING_KEY } from '@/lib/practice/note-rating';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
}));
jest.mock('@/lib/api', () => ({ api: { putNoteRating: jest.fn(), putReadingSessionRating: jest.fn() } }));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));

const putNoteRating = api.putNoteRating as jest.Mock;
const putReadingRating = api.putReadingSessionRating as jest.Mock;
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
  putReadingRating.mockReset().mockResolvedValue({});
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

// ── 리딩 「아쉬웠어요」 이유 칩(11/27) ─────────────────────────────────────────────────────

const reason = (name: string) => screen.getByRole('checkbox', { name });
const readingBodies = () => putReadingRating.mock.calls.map(([id, body]) => [id, { ...body, request_id: typeof body.request_id }]);

test('노트 평가는 아쉬웠어요를 골라도 이유 칩이 없다', async () => {
  await render(<ReportRating practiceId="p1" initial={null} />);
  await fireEvent.press(bad());
  expect(screen.queryAllByRole('checkbox')).toEqual([]);
  expect(screen.queryByText('느려요')).toBeNull();
});

test('리딩은 아쉬웠어요를 고를 때만 이유 칩을 보이고, 좋았어요면 숨긴다', async () => {
  await render(<ReadingRating sessionId="s1" />);
  expect(screen.queryAllByRole('checkbox')).toEqual([]);
  await fireEvent.press(screen.getByRole('button', { name: /좋았어요/ }));
  expect(screen.queryAllByRole('checkbox')).toEqual([]);
  await fireEvent.press(screen.getByRole('button', { name: /아쉬웠어요/ }));
  expect(screen.getAllByRole('checkbox').map((c) => c.props.accessibilityLabel)).toEqual([
    '상대 목소리가 어색해요',
    '다음 줄로 안 넘어가요',
    '말하는 중에 넘어가요',
    '느려요',
  ]);
});

test('이유 칩은 여럿 고르고 다시 눌러 풀 수 있으며, 칩만 골라도 보내고 reasons 를 기록한다', async () => {
  await render(<ReadingRating sessionId="s1" />);
  await fireEvent.press(screen.getByRole('button', { name: /아쉬웠어요/ }));
  await fireEvent.press(reason('느려요'));
  await fireEvent.press(reason('상대 목소리가 어색해요'));
  await fireEvent.press(reason('말하는 중에 넘어가요'));
  await fireEvent.press(reason('말하는 중에 넘어가요'));
  expect(reason('느려요')).toBeChecked();
  expect(reason('말하는 중에 넘어가요')).not.toBeChecked();

  await fireEvent.press(screen.getByRole('button', { name: '보내기' }));

  expect(screen.getByText('고마워요! 다음 리딩에 반영할게요.')).toBeOnTheScreen();
  // 칩 순서대로 붙는다(누른 순서와 상관없이).
  expect(readingBodies()[1]).toEqual(['s1', { request_id: 'string', rating: 'bad', comment: '상대 목소리가 어색해요, 느려요' }]);
  expect(log.mock.calls[0]).toEqual(['reading_rating_submit', { rating: 'bad', length: 0, result: 'sent', reasons: '' }]);
  expect(log.mock.calls[1]).toEqual(['reading_rating_submit', { rating: 'bad', length: 17, result: 'sent', reasons: 'voice,slow' }]);
});

test('이유와 글을 같이 보내면 이유 뒤에 글을 붙이고, 100자를 넘으면 자른다', async () => {
  await render(<ReadingRating sessionId="s1" />);
  await fireEvent.press(screen.getByRole('button', { name: /아쉬웠어요/ }));
  await fireEvent.press(reason('다음 줄로 안 넘어가요'));
  await fireEvent.changeText(screen.getByPlaceholderText('한 줄 더 남겨주실래요? (선택)'), '가'.repeat(100));
  await fireEvent.press(screen.getByRole('button', { name: '보내기' }));

  const comment = readingBodies()[1][1].comment as string;
  expect(comment).toHaveLength(100);
  expect(comment.startsWith('다음 줄로 안 넘어가요 / 가')).toBe(true);
  expect(log.mock.calls[1][1]).toEqual(expect.objectContaining({ length: 100, reasons: 'no_advance' }));
});

test('좋았어요로 바꿔 보내면 고른 이유를 붙이지 않는다', async () => {
  await render(<ReadingRating sessionId="s1" />);
  await fireEvent.press(screen.getByRole('button', { name: /아쉬웠어요/ }));
  await fireEvent.press(reason('느려요'));
  await fireEvent.press(screen.getByRole('button', { name: /좋았어요/ }));
  await fireEvent.changeText(screen.getByPlaceholderText('한 줄 더 남겨주실래요? (선택)'), '좋아요');
  await fireEvent.press(screen.getByRole('button', { name: '보내기' }));

  expect(readingBodies()[2]).toEqual(['s1', { request_id: 'string', rating: 'good', comment: '좋아요' }]);
  expect(log.mock.calls[2][1]).toEqual(expect.objectContaining({ reasons: '' }));
});

test('이유를 고르면 붙는 문구 길이만큼 한 줄 칸의 글자 수를 줄인다(쓴 글이 몰래 잘리지 않게)', async () => {
  await render(<ReadingRating sessionId="s1" />);
  await fireEvent.press(screen.getByRole('button', { name: /아쉬웠어요/ }));
  const input = () => screen.getByPlaceholderText('한 줄 더 남겨주실래요? (선택)');
  expect(input().props.maxLength).toBe(100);
  await fireEvent.press(reason('느려요'));
  // 「느려요 / 」 = 3 + 3
  expect(input().props.maxLength).toBe(94);
  await fireEvent.press(reason('상대 목소리가 어색해요'));
  // 「상대 목소리가 어색해요, 느려요 / 」
  expect(input().props.maxLength).toBe(100 - '상대 목소리가 어색해요, 느려요'.length - 3);
});

test('이유를 붙여 보낸 뒤 좋았어요로 바꾸면 이유 문구를 떼고 쓴 글만 함께 보낸다', async () => {
  await render(<ReadingRating sessionId="s1" />);
  await fireEvent.press(screen.getByRole('button', { name: /아쉬웠어요/ }));
  await fireEvent.press(reason('느려요'));
  await fireEvent.changeText(screen.getByPlaceholderText('한 줄 더 남겨주실래요? (선택)'), '끝부분이 빨라요');
  await fireEvent.press(screen.getByRole('button', { name: '보내기' }));
  expect(readingBodies()[1]).toEqual(['s1', { request_id: 'string', rating: 'bad', comment: '느려요 / 끝부분이 빨라요' }]);

  await fireEvent.press(screen.getByRole('button', { name: /좋았어요/ }));
  expect(readingBodies()[2]).toEqual(['s1', { request_id: 'string', rating: 'good', comment: '끝부분이 빨라요' }]);
  expect(log.mock.calls[2][1]).toEqual(expect.objectContaining({ rating: 'good', reasons: '' }));
});
