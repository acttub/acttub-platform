import { fireEvent, render, screen, userEvent } from '@testing-library/react-native';

import { ChallengeReportSheet } from '@/components/challenge-report-sheet';
import type { ReportTarget } from '@/lib/challenge/types';

// 사유 줄은 글자 뒤에 아이콘 글리프(사용자 영역 문자 하나)가 공백과 함께 접근 이름에 붙는다.
function radio(label: string) {
  return screen.getByRole('radio', { name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( [\\uE000-\\uF8FF])?$`) });
}

function backButtonTarget() {
  return screen.container.queryAll((node) => typeof node.props.onRequestClose === 'function')[0];
}

async function setup(target: ReportTarget = 'entry', visible = true) {
  const onClose = jest.fn();
  const onSubmit = jest.fn();
  await render(<ChallengeReportSheet visible={visible} target={target} onClose={onClose} onSubmit={onSubmit} />);
  return { onClose, onSubmit };
}

test.each([
  ['entry', '이 영상을 신고할까요?'],
  ['comment', '이 댓글을 신고할까요?'],
  ['challenge', '이 대사를 신고할까요?'],
] as const)('%s 신고는 대상에 맞는 제목을 보인다', async (target, title) => {
  await setup(target);
  expect(screen.getByText(title)).toBeOnTheScreen();
  expect(screen.getByText('접수되면 검토가 끝날 때까지 바로 숨겨져요.')).toBeOnTheScreen();
});

test('닫혀 있으면 아무것도 보이지 않는다', async () => {
  await setup('entry', false);
  expect(screen.queryByText('이 영상을 신고할까요?')).not.toBeOnTheScreen();
});

test('사유 다섯 개를 선택지로 두고, 고르기 전에는 신고하기가 꺼져 있다', async () => {
  await setup();
  expect(screen.getAllByRole('radio')).toHaveLength(5);
  for (const name of ['저작권 침해 — 대사·영상 출처 문제', '부적절한 콘텐츠', '스팸·중복 업로드', '중복 업로드', '기타']) {
    expect(radio(name)).not.toBeSelected();
  }
  expect(screen.getByRole('button', { name: '신고하기' })).toBeDisabled();
});

test('스팸을 골라 신고하면 사유와 빈 메모를 넘기고 선택을 비운다', async () => {
  const { onSubmit } = await setup('comment');
  await fireEvent.press(radio('스팸·중복 업로드'));
  expect(radio('스팸·중복 업로드')).toBeSelected();
  expect(screen.queryByText('무엇이 문제인지 알려 주세요 (선택)')).not.toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('button', { name: '신고하기' }));

  expect(onSubmit.mock.calls).toEqual([['spam', '']]);
  expect(radio('스팸·중복 업로드')).not.toBeSelected();
  expect(screen.getByRole('button', { name: '신고하기' })).toBeDisabled();
});

test('기타를 고르면 메모 칸과 글자 수가 나오고, 적은 메모를 함께 보낸다', async () => {
  const { onSubmit } = await setup();
  await userEvent.setup().press(radio('기타'));
  expect(radio('기타')).toBeSelected();
  expect(screen.getByText('무엇이 문제인지 알려 주세요 (선택)')).toBeOnTheScreen();
  expect(screen.getByText('0 / 200')).toBeOnTheScreen();

  await fireEvent.changeText(screen.getByDisplayValue(''), '출처가 다른 영상이에요');
  expect(screen.getByText('12 / 200')).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('button', { name: '신고하기' }));
  expect(onSubmit.mock.calls).toEqual([['other', '출처가 다른 영상이에요']]);
  expect(screen.queryByText('무엇이 문제인지 알려 주세요 (선택)')).not.toBeOnTheScreen();
});

test('메모가 200자를 넘으면 신고하기가 꺼진다', async () => {
  const { onSubmit } = await setup();
  await fireEvent.press(radio('기타'));
  await fireEvent.changeText(screen.getByDisplayValue(''), '가'.repeat(201));

  expect(screen.getByText('201 / 200')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: '신고하기' })).toBeDisabled();
  await fireEvent.press(screen.getByRole('button', { name: '신고하기' }));
  expect(onSubmit).not.toHaveBeenCalled();
});

test('닫으면 고른 사유와 메모를 비우고 닫는다', async () => {
  const { onClose, onSubmit } = await setup();
  await fireEvent.press(radio('기타'));
  await fireEvent.changeText(screen.getByDisplayValue(''), '메모');

  await fireEvent.press(screen.getByRole('button', { name: '닫기' }));

  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onSubmit).not.toHaveBeenCalled();
  expect(radio('기타')).not.toBeSelected();
  expect(screen.queryByDisplayValue('메모')).not.toBeOnTheScreen();
});

test('바깥을 누르거나 뒤로 가기를 해도 닫힌다', async () => {
  const { onClose } = await setup();
  await fireEvent.press(radio('부적절한 콘텐츠'));

  const [backdrop] = screen.getAllByRole('button');
  await fireEvent.press(backdrop);
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(radio('부적절한 콘텐츠')).not.toBeSelected();

  await fireEvent(backButtonTarget(), 'requestClose');
  expect(onClose).toHaveBeenCalledTimes(2);
});
