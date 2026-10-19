import { fireEvent, render, screen } from '@testing-library/react-native';

import AdmissionsScreen from '@/app/admissions/index';
import { api } from '@/lib/api';
import { admissions, notice, todayText, university } from '../helpers/admissions';

const mockRouter = { back: jest.fn(), push: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('@/lib/api', () => ({ api: { admissions: jest.fn() } }));

const getAdmissions = api.admissions as jest.Mock;

const payload = admissions({
  universities: [
    university({ id: 'u1', name: '한국예술대학교', region: '서울 성북구', campus: '석관', type: 'univ' }),
    university({ id: 'u2', name: '경기연기대학', region: '경기 수원시', type: 'college' }),
    university({ id: 'u3', name: '미정대학교', region: null, type: 'cyber' }),
    university({ id: 'u4', name: '마감대학교', region: '서울', type: 'univ' }),
    university({ id: 'u5', name: '날짜없는대학', region: '부산' }),
  ],
  notices: [
    notice({
      id: 'n1',
      university_id: 'u1',
      department: '연기과',
      track: '수시',
      discipline: 'acting',
      apply_start: '2020-01-01',
      apply_end: todayText(),
      csat_minimum: '없음',
      practical_items: [{ category: 'free_acting' }, { category: 'mime' }],
    }),
    notice({ id: 'n2', university_id: 'u1', department: '연기과', track: '정시', discipline: 'acting', apply_start: '2099-01-02' }),
    notice({ id: 'n3', university_id: 'u2', department: '뮤지컬과', track: '수시', discipline: 'musical', apply_end: '2099-12-31' }),
    notice({ id: 'n4', university_id: 'u4', department: null, track: '수시', discipline: 'dance', apply_start: '2020-01-01', apply_end: '2020-01-10' }),
    notice({ id: 'n5', university_id: 'u5', department: '공연예술과' }),
  ],
});

const names = () => screen.getAllByText(/대학(교)?$/).map((n) => n.props.children);

beforeEach(() => {
  jest.clearAllMocks();
  getAdmissions.mockResolvedValue(payload);
});

async function loaded() {
  await render(<AdmissionsScreen />);
  await screen.findByText('모집요강을 꼭 직접 확인하세요.');
}

test('대학을 가까운 접수 일정 순으로 보이고 일정을 배지로 알린다', async () => {
  await loaded();

  expect(screen.getByText('대학 5곳')).toBeOnTheScreen();
  expect(names()).toEqual(['한국예술대학교', '경기연기대학', '미정대학교', '날짜없는대학', '마감대학교']);
  expect(screen.getByText('석관')).toBeOnTheScreen();
  expect(screen.getByText('서울 성북구')).toBeOnTheScreen();
  expect(screen.getByText('연기과')).toBeOnTheScreen();
  expect(screen.getByText('학과 미확인')).toBeOnTheScreen();
  expect(screen.getByText('전형 정보 확인 중')).toBeOnTheScreen();
  expect(screen.getByText('D-DAY')).toBeOnTheScreen();
  expect(screen.getByText(/^D-\d+$/)).toBeOnTheScreen();
  expect(screen.getByText('정보 준비 중')).toBeOnTheScreen();
  expect(screen.getByText('접수 마감')).toBeOnTheScreen();
  expect(screen.getByText('일정 미정')).toBeOnTheScreen();
  expect(screen.getByText(/^2026-10-01 기준/)).toBeOnTheScreen();
});

test('대학을 누르면 상세로 간다', async () => {
  await loaded();
  await fireEvent.press(screen.getByText('경기연기대학'));
  expect(mockRouter.push).toHaveBeenCalledWith('/admissions/u2');
});

test('검색어로 대학·학과·지역을 찾는다', async () => {
  await loaded();
  await fireEvent.changeText(screen.getByPlaceholderText('대학·학과·지역 검색'), '뮤지컬');

  expect(names()).toEqual(['경기연기대학']);
  expect(screen.getByText('대학 1곳')).toBeOnTheScreen();

  await fireEvent.changeText(screen.getByPlaceholderText('대학·학과·지역 검색'), '없는말');
  expect(screen.getByText('조건에 맞는 대학이 없어요.')).toBeOnTheScreen();
});

test('접수 가능만 고르면 마감된 전형의 대학을 뺀다', async () => {
  await loaded();
  await fireEvent.press(screen.getByRole('button', { name: '접수 가능만' }));

  expect(screen.getByRole('button', { name: '접수 가능만' })).toBeSelected();
  expect(screen.getByRole('button', { name: '필터 1' })).toBeSelected();
  expect(names()).toEqual(['한국예술대학교', '경기연기대학', '날짜없는대학']);
});

describe('필터', () => {
  test('있는 값만 칩으로 보이고 이름표를 붙인다', async () => {
    await loaded();
    await fireEvent.press(screen.getByRole('button', { name: '필터' }));

    for (const label of ['경기', '부산', '서울', '수시', '정시', '연기', '뮤지컬', 'dance', '자유연기', 'mime', '4년제', '전문대', 'cyber', '수능 최저 없음']) {
      expect(screen.getByRole('button', { name: label })).toBeOnTheScreen();
    }
    expect(screen.queryByText('필터 초기화')).not.toBeOnTheScreen();
  });

  test('같은 축은 여럿 고르면 하나라도 맞는 대학을 보이고, 다시 누르면 푼다', async () => {
    await loaded();
    await fireEvent.press(screen.getByRole('button', { name: '필터' }));

    await fireEvent.press(screen.getByRole('button', { name: '경기' }));
    expect(names()).toEqual(['경기연기대학']);
    await fireEvent.press(screen.getByRole('button', { name: '부산' }));
    expect(names()).toEqual(['경기연기대학', '날짜없는대학']);
    expect(screen.getByRole('button', { name: '필터 2' })).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: '경기' }));
    expect(names()).toEqual(['날짜없는대학']);
  });

  test.each([
    ['정시', ['한국예술대학교']],
    ['뮤지컬', ['경기연기대학']],
    ['자유연기', ['한국예술대학교']],
    ['전문대', ['경기연기대학']],
    ['수능 최저 없음', ['한국예술대학교']],
  ])('%s 칩으로 거른다', async (label, expected) => {
    await loaded();
    await fireEvent.press(screen.getByRole('button', { name: '필터' }));
    await fireEvent.press(screen.getByRole('button', { name: label }));
    expect(names()).toEqual(expected);
  });

  test('필터 초기화는 검색어만 남기고 모두 푼다', async () => {
    await loaded();
    await fireEvent.changeText(screen.getByPlaceholderText('대학·학과·지역 검색'), '대학');
    await fireEvent.press(screen.getByRole('button', { name: '필터' }));
    await fireEvent.press(screen.getByRole('button', { name: '서울' }));
    await fireEvent.press(screen.getByRole('button', { name: '접수 가능만' }));
    expect(screen.getByRole('button', { name: '필터 2' })).toBeOnTheScreen();

    await fireEvent.press(screen.getByText('필터 초기화'));

    expect(screen.getByRole('button', { name: '필터' })).not.toBeSelected();
    expect(screen.getByDisplayValue('대학')).toBeOnTheScreen();
    expect(screen.getByText('대학 5곳')).toBeOnTheScreen();
  });

  test('필터 버튼을 다시 누르면 패널을 닫는다', async () => {
    await loaded();
    await fireEvent.press(screen.getByRole('button', { name: '필터' }));
    expect(screen.getByText('지역')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: '필터' }));
    expect(screen.queryByText('지역')).not.toBeOnTheScreen();
  });

  test('실기 종목을 아는 공고가 없으면 그 줄을 감춘다', async () => {
    getAdmissions.mockResolvedValue(admissions({ universities: [university()], notices: [notice({ track: '수시' })] }));
    await render(<AdmissionsScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: '필터' }));

    expect(screen.getByText('전형')).toBeOnTheScreen();
    expect(screen.queryByText('실기 종목')).not.toBeOnTheScreen();
    expect(screen.queryByText('지역')).not.toBeOnTheScreen();
  });
});

test('못 불러오면 그렇다고 알린다', async () => {
  getAdmissions.mockRejectedValue(new Error('down'));
  await render(<AdmissionsScreen />);
  expect(await screen.findByText('입시 정보를 불러오지 못했어요.')).toBeOnTheScreen();
});

test('뒤로는 이전 화면으로 간다', async () => {
  await loaded();
  await fireEvent.press(screen.getByRole('button', { name: '뒤로' }));
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
});
