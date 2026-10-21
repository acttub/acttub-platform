import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { Linking } from 'react-native';

import AuditionsScreen from '@/app/auditions/index';
import { api } from '@/lib/api';
import { readAuditionMarks, writeAuditionMarks } from '@/lib/audition-marks';
import type { AuditionPosting } from '@/lib/auditions';

const mockRouter = { back: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('@/lib/api', () => ({ api: { auditions: jest.fn() } }));
jest.mock('@/lib/audition-marks', () => ({ readAuditionMarks: jest.fn(), writeAuditionMarks: jest.fn() }));

const getAuditions = api.auditions as jest.Mock;

/** 한국 시간 오늘에서 n일 뒤(YYYY-MM-DD). */
function kstDay(n: number): string {
  return new Date(Date.now() + 9 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
}
const md = (n: number) => {
  const [, m, d] = kstDay(n).split('-');
  return `${Number(m)}/${Number(d)}`;
};

function posting(overrides: Partial<AuditionPosting>): AuditionPosting {
  return {
    id: 'a',
    title: '공고',
    category: 'film',
    source: 'filmo',
    source_name: '필모',
    pay_text: null,
    apply_end: null,
    posted_on: null,
    source_url: 'https://src/a',
    ...overrides,
  };
}

const today = posting({ id: 'a1', title: '장편 영화 주연', category: 'film', apply_end: kstDay(0), pay_text: '회당 50만원', posted_on: kstDay(0) });
const soon = posting({ id: 'a2', title: '웹드라마 조연', category: 'web_drama', apply_end: kstDay(2), pay_text: '협의' });
const fiveDays = posting({ id: 'a3', title: '광고 모델', category: 'commercial', apply_end: kstDay(5), posted_on: kstDay(-3) });
const later = posting({ id: 'a4', title: '연극 앙상블', category: 'theater', apply_end: kstDay(20), source_name: '플레이DB' });
const unknown = posting({ id: 'a5', title: '기획사 공개 오디션', category: 'mystery', apply_end: null });
const expired = posting({ id: 'a7', title: '지난 공고', apply_end: kstDay(-1) });

beforeEach(() => {
  jest.clearAllMocks();
  getAuditions.mockResolvedValue({
    items: [later, unknown, today, soon, fiveDays, expired],
    collected_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
  });
  (readAuditionMarks as jest.Mock).mockResolvedValue(new Set());
  (writeAuditionMarks as jest.Mock).mockResolvedValue(undefined);
});

async function loaded() {
  await render(<AuditionsScreen />);
  await screen.findByText('장편 영화 주연');
}

const titles = () => screen.getAllByRole('link').map((card) => card.props.accessibilityLabel.replace(' 원문 열기', ''));

test('마감이 가까운 순으로 묶고 남은 날짜를 보여 준다', async () => {
  await loaded();

  expect(screen.getByText('2시간 전 수집 · 5건')).toBeOnTheScreen();
  expect(titles()).toEqual(['장편 영화 주연', '웹드라마 조연', '광고 모델', '연극 앙상블', '기획사 공개 오디션']);
  expect(screen.getByText('이번 주 마감 · 3')).toBeOnTheScreen();
  expect(screen.getByText('여유 있음 · 1')).toBeOnTheScreen();
  expect(screen.getByText('마감일은 원문 확인 · 1')).toBeOnTheScreen();
  expect(screen.getByText('D-DAY')).toBeOnTheScreen();
  expect(screen.getByText('D-2')).toBeOnTheScreen();
  expect(screen.getByText('D-20')).toBeOnTheScreen();
  expect(screen.getByText(`${md(5)} 마감`)).toBeOnTheScreen();
  expect(screen.getByText('미표기')).toBeOnTheScreen();
  expect(screen.queryByText('지난 공고')).not.toBeOnTheScreen();
});

test('카드에 분야·출처·출연료·등록일과 새 공고 표시를 단다', async () => {
  await loaded();
  const card = (title: string) => within(screen.getByRole('link', { name: `${title} 원문 열기` }));

  expect(card('장편 영화 주연').getByText('NEW')).toBeOnTheScreen();
  expect(card('장편 영화 주연').getByText('영화')).toBeOnTheScreen();
  expect(card('장편 영화 주연').getByText(`출연료 회당 50만원 · ${md(0)} 등록`)).toBeOnTheScreen();
  expect(card('광고 모델').getByText(`${md(-3)} 등록`)).toBeOnTheScreen();
  expect(card('광고 모델').queryByText('NEW')).not.toBeOnTheScreen();
  expect(card('기획사 공개 오디션').getByText('기타')).toBeOnTheScreen();
  expect(card('연극 앙상블').getByText('플레이DB')).toBeOnTheScreen();
});

test('분야 칩은 건수를 달고, 고르면 그 분야만 보인다', async () => {
  await loaded();

  expect(screen.getByRole('button', { name: '전체 5' })).toBeSelected();
  expect(screen.getByRole('button', { name: '영화·드라마 2' })).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: /^숏폼/ })).not.toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('button', { name: '영화·드라마 2' }));

  expect(titles()).toEqual(['장편 영화 주연', '웹드라마 조연']);
  expect(screen.getByText('2시간 전 수집 · 2건')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: '초기화' })).toBeOnTheScreen();
});

test.each([
  ['7일 안에 마감', ['장편 영화 주연', '웹드라마 조연', '광고 모델']],
  ['출연료 명시', ['장편 영화 주연']],
])('%s 토글로 거른다', async (label, expected) => {
  await loaded();
  await fireEvent.press(screen.getByRole('button', { name: label }));
  expect(titles()).toEqual(expected);
  expect(screen.getByRole('button', { name: label })).toBeSelected();
});

test('검색어는 제목·출연료·출처를 모두 찾고, 없으면 조건에 맞는 공고가 없다고 한다', async () => {
  await loaded();
  await fireEvent.changeText(screen.getByPlaceholderText('제목·출연료·출처 검색'), '플레이db');
  expect(titles()).toEqual(['연극 앙상블']);

  await fireEvent.changeText(screen.getByPlaceholderText('제목·출연료·출처 검색'), '없는공고');
  expect(screen.getByText('찾는 공고가 없어요')).toBeOnTheScreen();
  expect(screen.getByText('「초기화」를 누르면 모든 공고가 다시 보여요.')).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('button', { name: '초기화' }));
  expect(screen.getByDisplayValue('')).toBeOnTheScreen();
  expect(titles()).toHaveLength(5);
  expect(screen.queryByRole('button', { name: '초기화' })).not.toBeOnTheScreen();
});

describe('찜', () => {
  test('별을 누르면 찜하고 기기에 남기며, 찜한 공고만 볼 수 있다', async () => {
    await loaded();

    await fireEvent.press(within(screen.getByRole('link', { name: '광고 모델 원문 열기' })).getByRole('button', { name: '찜하기' }));

    expect(writeAuditionMarks).toHaveBeenCalledWith('starred', new Set(['a3']));
    expect(screen.getByRole('button', { name: '찜 해제' })).toBeSelected();
    await fireEvent.press(screen.getByRole('button', { name: '찜한 공고' }));
    expect(titles()).toEqual(['광고 모델']);

    await fireEvent.press(screen.getByRole('button', { name: '찜 해제' }));
    expect(writeAuditionMarks).toHaveBeenLastCalledWith('starred', new Set());
    expect(screen.getByText('찜한 공고가 없어요. 카드 오른쪽 별을 눌러 모아 두세요.')).toBeOnTheScreen();
  });

  test('기기에 남긴 찜을 불러온다', async () => {
    (readAuditionMarks as jest.Mock).mockImplementation(async (mark: string) => new Set(mark === 'starred' ? ['a4'] : []));
    await loaded();

    expect(within(screen.getByRole('link', { name: '연극 앙상블 원문 열기' })).getByRole('button', { name: '찜 해제' })).toBeSelected();
  });
});

test('카드를 누르면 원문을 열고 본 공고로 한 번만 남긴다', async () => {
  const openURL = jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no browser'));
  await loaded();

  await fireEvent.press(screen.getByRole('link', { name: '광고 모델 원문 열기' }));
  await fireEvent.press(screen.getByRole('link', { name: '광고 모델 원문 열기' }));

  expect(openURL.mock.calls).toEqual([['https://src/a'], ['https://src/a']]);
  expect((writeAuditionMarks as jest.Mock).mock.calls).toEqual([['seen', new Set(['a3'])]]);
});

test('공고가 하나도 없으면 하루 두 번 모은다고 알린다', async () => {
  getAuditions.mockResolvedValue({ items: [], collected_at: null });
  await render(<AuditionsScreen />);

  expect(await screen.findByText('지금 지원할 수 있는 공고가 없어요. 하루 두 번 새로 모아요.')).toBeOnTheScreen();
  expect(screen.getByText('0건')).toBeOnTheScreen();
});

test('못 불러오면 다시 시도를 둔다', async () => {
  getAuditions.mockRejectedValueOnce(new Error('down'));
  await render(<AuditionsScreen />);

  expect(await screen.findByText('공고를 불러오지 못했어요')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '다시 시도' }));
  expect(await screen.findByText('장편 영화 주연')).toBeOnTheScreen();
});

test('당겨서 새로고침하면 다시 받는다', async () => {
  await loaded();
  getAuditions.mockResolvedValue({ items: [later], collected_at: null });

  // 당기기 제스처는 목록의 refreshControl 이 받는다. 테스트 렌더러에는 제스처가 없어 그 콜백을 직접 부른다.
  const [list] = screen.container.queryAll((node) => node.props.refreshControl !== undefined);
  await act(async () => list.props.refreshControl.props.onRefresh());

  expect(getAuditions).toHaveBeenCalledTimes(2);
  expect(titles()).toEqual(['연극 앙상블']);
  expect(screen.getByText('1건')).toBeOnTheScreen();
});

test('뒤로는 이전 화면으로 간다', async () => {
  await loaded();
  await fireEvent.press(screen.getByRole('button', { name: '뒤로' }));
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
});
