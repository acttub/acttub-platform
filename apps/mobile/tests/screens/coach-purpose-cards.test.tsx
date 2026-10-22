import { fireEvent, render, screen } from '@testing-library/react-native';
import { CoachPurposeCards } from '@/components/coach-purpose-cards';
import type { CoachPurpose } from '@/lib/practice/types';
const base: CoachPurpose = { purpose: 'evaluate', step: 'card', choices: [], scene: null, lines: [], character_card: null,
  card: { good: { text: '멈춤이 보여요', at: 12 }, issue: { text: '시선이 흩어져요', at: 20 }, next: { text: '상대를 봐요', at: null } } };
test('평가 결과의 세 항목과 영상 시간을 보인다', async () => {
  const seek = jest.fn();
  await render(<CoachPurposeCards purpose={base} hasVideo onSeek={seek} />);
  expect(screen.getByText('평가 결과')).toBeOnTheScreen();
  for (const text of ['잘 된 곳', '아쉬운 곳', '다음 테이크', '상대를 봐요']) expect(screen.getByText(text)).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('0:12')); expect(seek).toHaveBeenCalledWith(12);
});
test('영상 없는 막힌 곳 정리는 시간 버튼을 숨긴다', async () => {
  await render(<CoachPurposeCards purpose={{ ...base, purpose: 'stuck', step: 'wrap' }} hasVideo={false} onSeek={jest.fn()} />);
  expect(screen.getByText('막힌 곳 정리')).toBeOnTheScreen();
  expect(screen.queryByRole('button')).toBeNull();
});
test('인물 카드의 출처와 아직 비어 있는 칸을 보인다', async () => {
  await render(<CoachPurposeCards purpose={{ ...base, purpose: 'character', character_card: { cells: [
    ...['내 말', '대본', '같이 찾음', '영상'].map((source, i) => ({ key: String(i), label: `칸${i}`, value: `내용${i}`, source })),
    { key: 'empty', label: '빈 칸', value: '', source: '' },
  ] } }} hasVideo={false} onSeek={jest.fn()} />);
  for (const text of ['인물 카드', '내 말', '대본', '같이 찾음', '영상', '아직 함께 찾는 중이에요']) expect(screen.getByText(text)).toBeOnTheScreen();
});
test.each([null, { ...base, purpose: 'stuck' as const, step: 'reason' }, { ...base, card: null }])('아직 결과가 없으면 카드를 만들지 않는다', async (purpose) => {
  await render(<CoachPurposeCards purpose={purpose} hasVideo={false} onSeek={jest.fn()} />);
  expect(screen.queryByTestId('coach-purpose-card')).toBeNull();
});
