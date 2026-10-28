import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { ChallengeCommentsSheet } from '@/components/challenge-comments-sheet';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api-request';
import type { EntryComment } from '@/lib/challenge/types';

jest.mock('@/lib/api', () => ({ api: { listComments: jest.fn(), createComment: jest.fn(), deleteComment: jest.fn() } }));
jest.mock('@/hooks/use-keyboard-height', () => ({ useKeyboardHeight: jest.fn(() => 0) }));

const listComments = api.listComments as jest.Mock;
const createComment = api.createComment as jest.Mock;
const deleteComment = api.deleteComment as jest.Mock;
const keyboardHeight = useKeyboardHeight as jest.Mock;

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

function comment(id: string, over: Partial<EntryComment> = {}): EntryComment {
  return {
    id,
    author: { name: '윤서', user_id: `u-${id}` },
    body: `댓글 ${id}`,
    created_at: minutesAgo(5),
    is_mine: false,
    author_withdrawn: false,
    status: 'visible',
    ...over,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  listComments.mockReset().mockResolvedValue({ comments: [], next_cursor: null });
  createComment.mockReset();
  deleteComment.mockReset().mockResolvedValue(undefined);
  keyboardHeight.mockReturnValue(0);
});

type Props = Partial<Parameters<typeof ChallengeCommentsSheet>[0]>;

async function open(props: Props = {}) {
  const handlers = { onClose: jest.fn(), onReport: jest.fn(), onCountChange: jest.fn() };
  const all = { visible: true, entryId: 'e1', ...handlers, ...props };
  const view = await render(<ChallengeCommentsSheet {...all} />);
  return { ...handlers, ...all, view };
}

const input = () => screen.getByPlaceholderText('응원 댓글을 남겨보세요');
const sendButton = () => screen.getByRole('button', { name: '보내기' });
const list = () => screen.container.queryAll((node) => typeof node.props.onScroll === 'function')[0];
const modal = () => screen.container.queryAll((node) => typeof node.props.onRequestClose === 'function')[0];

describe('목록', () => {
  test('닫혀 있으면 불러오지 않고 아무것도 보이지 않는다', async () => {
    await open({ visible: false });
    expect(listComments).not.toHaveBeenCalled();
    expect(screen.queryByText('댓글 0')).not.toBeOnTheScreen();
  });

  test('참여작이 정해지지 않았으면 불러오지 않는다', async () => {
    await open({ entryId: null });
    expect(listComments).not.toHaveBeenCalled();
    expect(screen.getByText('댓글 0')).toBeOnTheScreen();
    expect(screen.queryByText('아직 댓글이 없어요')).not.toBeOnTheScreen();
  });

  test('댓글마다 이름·올린 때·본문과, 내 댓글엔 삭제·남의 댓글엔 신고를 보인다', async () => {
    listComments.mockResolvedValue({
      comments: [
        comment('c1', { author: { name: '나', user_id: 'me' }, body: '첫 촬영 응원해요', is_mine: true }),
        comment('c2', { author: { name: '태오', user_id: 'u2' }, body: '좋아요!' }),
      ],
      next_cursor: null,
    });
    await open();

    expect(await screen.findByText('댓글 2')).toBeOnTheScreen();
    expect(listComments.mock.calls).toEqual([['e1']]);
    expect(screen.getByText('첫 촬영 응원해요')).toBeOnTheScreen();
    expect(screen.getByText('좋아요!')).toBeOnTheScreen();
    expect(screen.getByText('태')).toBeOnTheScreen();
    expect(screen.getAllByText('5분 전', { exact: false })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: '삭제' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: '신고' })).toHaveLength(1);
  });

  test('신고로 숨겨진 내 댓글은 "확인 중"으로, 탈퇴한 작성자는 "탈퇴한 사용자"로 보인다', async () => {
    listComments.mockResolvedValue({
      comments: [
        comment('c1', { body: '원래 글', status: 'hidden', is_mine: true }),
        comment('c2', { author: { name: '민재', user_id: 'u2' }, author_withdrawn: true }),
      ],
      next_cursor: null,
    });
    await open();

    expect(await screen.findByText('확인 중인 댓글이에요.')).toBeOnTheScreen();
    expect(screen.queryByText('원래 글')).not.toBeOnTheScreen();
    expect(screen.getByText('탈퇴한 사용자')).toBeOnTheScreen();
    expect(screen.queryByText('민재')).not.toBeOnTheScreen();
  });

  test('댓글이 없으면 첫 댓글을 권한다', async () => {
    await open();
    expect(await screen.findByText('아직 댓글이 없어요')).toBeOnTheScreen();
    expect(screen.getByText('첫 댓글을 남겨 보세요.')).toBeOnTheScreen();
  });

  test('불러오지 못하면 까닭을 보이고 빈 목록 안내는 감춘다', async () => {
    listComments.mockRejectedValue(new ApiError(403, 'forbidden', 'member_only'));
    await open();
    expect(await screen.findByText('챌린지는 회원만 이용할 수 있어요.')).toBeOnTheScreen();
    expect(screen.queryByText('아직 댓글이 없어요')).not.toBeOnTheScreen();
    expect(screen.getByText('댓글 0')).toBeOnTheScreen();
  });

  test('다시 열면 새로 불러온다', async () => {
    const { view, ...props } = await open();
    await screen.findByText('아직 댓글이 없어요');
    await view.rerender(<ChallengeCommentsSheet {...props} visible={false} />);
    listComments.mockResolvedValue({ comments: [comment('c9')], next_cursor: null });
    await view.rerender(<ChallengeCommentsSheet {...props} visible />);
    expect(await screen.findByText('댓글 c9')).toBeOnTheScreen();
    expect(listComments).toHaveBeenCalledTimes(2);
  });
});

describe('이어 받기', () => {
  async function scrollToEnd() {
    const scroller = list();
    await fireEvent(scroller, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 400 } } });
    await fireEvent(scroller, 'contentSizeChange', 360, 1000);
    // 목록은 그릴 칸 범위를 50ms 묶음으로 다시 잡는다. 그 뒤라야 마지막 칸이 그려진 것으로 보고 끝 도달을 알린다.
    await act(() => new Promise((resolve) => setTimeout(resolve, 80)));
    await fireEvent.scroll(scroller, {
      nativeEvent: {
        contentOffset: { x: 0, y: 600 },
        contentSize: { width: 360, height: 1000 },
        layoutMeasurement: { width: 360, height: 400 },
      },
    });
  }

  test('끝까지 내리면 다음 묶음을 받아 아래에 붙인다', async () => {
    listComments
      .mockResolvedValueOnce({ comments: [comment('c1')], next_cursor: 'cur-2' })
      .mockResolvedValueOnce({ comments: [comment('c2')], next_cursor: null });
    await open();
    await screen.findByText('댓글 1');

    await scrollToEnd();

    expect(await screen.findByText('댓글 c2')).toBeOnTheScreen();
    expect(screen.getByText('댓글 2')).toBeOnTheScreen();
    expect(listComments.mock.calls).toEqual([['e1'], ['e1', 'cur-2']]);
  });

  test('다음 묶음이 없으면 더 받지 않는다', async () => {
    listComments.mockResolvedValue({ comments: [comment('c1')], next_cursor: null });
    await open();
    await screen.findByText('댓글 1');
    await scrollToEnd();
    expect(listComments).toHaveBeenCalledTimes(1);
  });

  test('다음 묶음을 못 받으면 있던 목록을 그대로 둔다', async () => {
    listComments
      .mockResolvedValueOnce({ comments: [comment('c1')], next_cursor: 'cur-2' })
      .mockRejectedValueOnce(new Error('down'));
    await open();
    await screen.findByText('댓글 1');
    await scrollToEnd();
    await act(async () => {});
    expect(listComments).toHaveBeenCalledTimes(2);
    expect(screen.getByText('댓글 c1')).toBeOnTheScreen();
    expect(screen.getByText('댓글 1')).toBeOnTheScreen();
  });
});

describe('쓰기', () => {
  test('공백을 정리해 보내고, 새 댓글을 맨 위에 올리고 칸을 비운다', async () => {
    listComments.mockResolvedValue({ comments: [comment('c1')], next_cursor: null });
    createComment.mockImplementation(async (_entry: string, body: { body: string }) =>
      comment('new', { body: body.body, is_mine: true, author: { name: '나', user_id: 'me' } }),
    );
    const { onCountChange } = await open();
    await screen.findByText('댓글 1');
    expect(sendButton()).toBeDisabled();

    await fireEvent.changeText(input(), '  최고   예요  ');
    await fireEvent.press(sendButton());

    expect(createComment).toHaveBeenCalledTimes(1);
    const [entryId, body] = createComment.mock.calls[0];
    expect(entryId).toBe('e1');
    expect(body.body).toBe('최고 예요');
    expect(body.request_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await screen.findByText('최고 예요')).toBeOnTheScreen();
    expect(screen.getByText('댓글 2')).toBeOnTheScreen();
    expect(onCountChange.mock.calls).toEqual([[1]]);
    expect(input()).toHaveDisplayValue('');
  });

  test('공백만 적으면 보낼 수 없다', async () => {
    await open();
    await fireEvent.changeText(input(), '   ');
    expect(sendButton()).toBeDisabled();
  });

  test('실패한 같은 글을 다시 보내면 같은 요청 id 를, 글을 고치면 새 id 를 쓴다', async () => {
    createComment.mockRejectedValueOnce(new ApiError(429, 'limit', 'daily_comment_limit'));
    createComment.mockRejectedValueOnce(new ApiError(503, 'down'));
    createComment.mockResolvedValueOnce(comment('new', { body: '응원해요!', is_mine: true }));
    await open();
    await screen.findByText('아직 댓글이 없어요');

    await fireEvent.changeText(input(), '응원해요');
    await fireEvent.press(sendButton());
    expect(await screen.findByText('댓글은 하루 100개까지 쓸 수 있어요.')).toBeOnTheScreen();

    await fireEvent.press(sendButton());
    expect(await screen.findByText('연결이 끊겼어요. 잠시 뒤 다시 시도해 주세요.')).toBeOnTheScreen();

    await fireEvent.changeText(input(), '응원해요!');
    await fireEvent.press(sendButton());
    expect(await screen.findByText('댓글 1')).toBeOnTheScreen();
    expect(screen.queryByText('연결이 끊겼어요. 잠시 뒤 다시 시도해 주세요.')).not.toBeOnTheScreen();

    const ids = createComment.mock.calls.map(([, body]) => body.request_id);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[1]);
    expect(createComment.mock.calls.map(([, body]) => body.body)).toEqual(['응원해요', '응원해요', '응원해요!']);
  });

  test('보내는 동안은 다시 보낼 수 없다', async () => {
    const pending = deferred<EntryComment>();
    createComment.mockReturnValue(pending.promise);
    await open();
    await screen.findByText('아직 댓글이 없어요');
    await fireEvent.changeText(input(), '응원해요');
    await fireEvent.press(sendButton());

    expect(sendButton()).toBeDisabled();
    await fireEvent.press(sendButton());
    expect(createComment).toHaveBeenCalledTimes(1);

    await act(async () => pending.resolve(comment('new', { body: '응원해요', is_mine: true })));
    expect(screen.getByText('댓글 1')).toBeOnTheScreen();
  });

  test('목록을 받기 전에 보낸 댓글도 바로 보인다', async () => {
    listComments.mockReturnValue(new Promise(() => {}));
    createComment.mockResolvedValue(comment('new', { body: '먼저 씀', is_mine: true }));
    await open();
    await fireEvent.changeText(input(), '먼저 씀');
    await fireEvent.press(sendButton());
    expect(await screen.findByText('먼저 씀')).toBeOnTheScreen();
    expect(screen.getByText('댓글 1')).toBeOnTheScreen();
  });

  test('참여작이 정해지지 않았으면 눌러도 보내지 않는다', async () => {
    await open({ entryId: null });
    await fireEvent.changeText(input(), '응원해요');
    await fireEvent.press(sendButton());
    expect(createComment).not.toHaveBeenCalled();
  });

  test('댓글 수를 알릴 곳이 없어도 쓰고 지울 수 있다', async () => {
    listComments.mockResolvedValue({ comments: [comment('c1', { is_mine: true })], next_cursor: null });
    createComment.mockResolvedValue(comment('new', { body: '하나 더', is_mine: true }));
    await open({ onCountChange: undefined });
    await screen.findByText('댓글 1');

    await fireEvent.changeText(input(), '하나 더');
    await fireEvent.press(sendButton());
    expect(await screen.findByText('댓글 2')).toBeOnTheScreen();

    await fireEvent.press(screen.getAllByRole('button', { name: '삭제' })[1]);
    // 지우기 전에 한 번 묻는다(10/28).
    await fireEvent.press(await screen.findByRole('button', { name: '지우기' }));
    expect(await screen.findByText('댓글 1')).toBeOnTheScreen();
    expect(screen.queryByText('댓글 c1')).not.toBeOnTheScreen();
  });

  test('한도 50자 앞부터 글자 수를 보인다', async () => {
    await open();
    await fireEvent.changeText(input(), '가'.repeat(449));
    expect(screen.queryByText('449 / 500')).not.toBeOnTheScreen();
    await fireEvent.changeText(input(), '가'.repeat(450));
    expect(screen.getByText('450 / 500')).toBeOnTheScreen();
  });

  test('키보드가 떠 있어도 써서 보낼 수 있다', async () => {
    keyboardHeight.mockReturnValue(300);
    createComment.mockResolvedValue(comment('new', { body: '응원해요', is_mine: true }));
    await open();
    await fireEvent.changeText(input(), '응원해요');
    await fireEvent.press(sendButton());
    expect(await screen.findByText('응원해요')).toBeOnTheScreen();
  });
});

describe('지우기·신고', () => {
  test('내 댓글을 지우면 목록에서 빠지고 댓글 수를 하나 줄인다', async () => {
    listComments.mockResolvedValue({
      comments: [comment('c1', { is_mine: true }), comment('c2')],
      next_cursor: null,
    });
    const { onCountChange } = await open();
    await screen.findByText('댓글 2');

    await fireEvent.press(screen.getByRole('button', { name: '삭제' }));
    // 지우기 전에 한 번 묻는다(10/28).
    await fireEvent.press(await screen.findByRole('button', { name: '지우기' }));

    expect(deleteComment.mock.calls).toEqual([['c1']]);
    expect(await screen.findByText('댓글 1')).toBeOnTheScreen();
    expect(screen.queryByText('댓글 c1')).not.toBeOnTheScreen();
    expect(onCountChange.mock.calls).toEqual([[-1]]);
  });

  test('지우지 못하면 댓글을 그대로 두고 까닭을 보인다', async () => {
    listComments.mockResolvedValue({ comments: [comment('c1', { is_mine: true })], next_cursor: null });
    deleteComment.mockRejectedValue(new ApiError(404, 'gone', 'comment_not_found'));
    const { onCountChange } = await open();
    await screen.findByText('댓글 1');

    await fireEvent.press(screen.getByRole('button', { name: '삭제' }));
    // 지우기 전에 한 번 묻는다(10/28).
    await fireEvent.press(await screen.findByRole('button', { name: '지우기' }));

    expect(await screen.findByText('이 영상은 더 이상 볼 수 없어요.')).toBeOnTheScreen();
    expect(screen.getByText('댓글 c1')).toBeOnTheScreen();
    expect(onCountChange).not.toHaveBeenCalled();
  });

  test('남의 댓글의 신고를 누르면 그 댓글 id 로 신고를 연다', async () => {
    listComments.mockResolvedValue({ comments: [comment('c2')], next_cursor: null });
    const { onReport } = await open();
    await screen.findByText('댓글 1');
    await fireEvent.press(screen.getByRole('button', { name: '신고' }));
    expect(onReport.mock.calls).toEqual([['c2']]);
  });
});

describe('닫기', () => {
  test('닫기 버튼을 누르거나 뒤로 가기를 하면 닫힌다', async () => {
    const { onClose } = await open();
    await fireEvent.press(screen.getByRole('button', { name: '닫기' }));
    await fireEvent(modal(), 'requestClose');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

});
