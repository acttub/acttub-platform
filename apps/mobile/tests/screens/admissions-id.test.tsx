import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

import UniversityDetailScreen from '@/app/admissions/[id]';
import { api } from '@/lib/api';
import { admissions, notice, todayText, university } from '../helpers/admissions';

const mockRouter = { back: jest.fn() };
let mockParams: { id?: string } = {};
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => mockParams }));
jest.mock('@/lib/api', () => ({ api: { admissionsByUniversity: jest.fn() } }));

const byUniversity = api.admissionsByUniversity as jest.Mock;

const uni = university({
  id: 'u1',
  name: '한국예술대학교',
  campus: '석관',
  type: 'college',
  region: '서울 성북구',
  admission_url: 'https://admission.example.ac.kr',
  tips: [
    { text: '대기실이 추워요', category: 'day_of', source_type: 'personal', corroborations: 3, host: '네이버 블로그', source_url: 'https://blog/1', note: '2025년 기준' },
    { text: '정문으로 들어가세요', category: 'mystery', source_type: 'forum', corroborations: 1 },
  ],
  resources: [
    { kind: 'video', title: '합격 자유연기', url: 'https://yt/1', publisher: '배우지망생', source_type: 'personal' },
    { kind: 'video', title: '입학처 안내', url: 'https://yt/2', publisher: '한예대', source_type: 'official' },
    { kind: 'video', title: '학원 시범', url: 'https://yt/3', publisher: '연기학원', source_type: 'academy' },
    { kind: 'video', title: '출처 모름', url: 'https://yt/4', publisher: '누군가', source_type: 'mystery' },
  ],
});

const full = notice({
  id: 'n1',
  department: '연기과',
  track: '수시',
  discipline: 'acting',
  screening: '실기우수자전형',
  apply_start: '2099-01-02',
  apply_end: '2099-01-05',
  practical_date: '2099-02-01',
  practical_date_end: '2099-02-03',
  announce_date: '2099-03-01',
  quota: '20명',
  fee: '80,000원',
  weights: { practical: 70, transcript: 30, csat: 0 },
  weights_note: '면접은 실기에 포함',
  stages: [
    { order: 2, name: '2차 실기', date: '2099-02-03', evaluates: ['free_acting', 'mime'], multiple: null, weight: 0, note: '1차 성적 미반영' },
    { order: 1, name: '1차 실기', date: null, evaluates: ['song'], multiple: '5배수', weight: 100 },
    { order: 3, name: '서류', date: '2099-02-10', evaluates: [] },
  ],
  practical_items: [
    { category: 'free_acting', label: '독백', required: true, time_limit_sec: 90, count: 1, weight: 60, stage: 1, note: '현대극' },
    { category: 'mime', required: false, time_limit_sec: 60 },
    { category: 'song', time_limit_sec: 30 },
  ],
  practical_task: '자유연기 1분 30초',
  dress_code: '검은 옷',
  preparation: '수험표',
  documents: '자기소개서',
  csat_minimum: '없음',
  designated_works: ['햄릿', '갈매기'],
  essay_questions: ['왜 배우인가', '인생 작품'],
  results: [
    { year: 2025, competition_rate: '12.5:1', transcript_avg: '3.2', practical_avg: '85', fill_rate: '120%', waitlist_last: 4 },
    { year: 2024, competition_rate: '10:1', note: '정원 변경' },
    { year: 2023, competition_rate: null },
  ],
  note: '모집요강 2026 기준',
  source_url: 'https://notice/1',
});

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { id: 'u1' };
  byUniversity.mockResolvedValue(admissions({ universities: [uni], notices: [full] }));
});

async function loaded() {
  await render(<UniversityDetailScreen />);
  await screen.findByText('모집요강을 꼭 직접 확인하세요.');
}

test('대학 머리와 전형 일정을 보여 준다', async () => {
  await loaded();

  expect(byUniversity).toHaveBeenCalledWith('u1');
  expect(screen.getAllByText('한국예술대학교')).toHaveLength(2);
  expect(screen.getByText('석관')).toBeOnTheScreen();
  expect(screen.getByText('전문대')).toBeOnTheScreen();
  expect(screen.getByText('서울 성북구')).toBeOnTheScreen();
  expect(screen.getByText('수시')).toBeOnTheScreen();
  expect(screen.getByText('연기')).toBeOnTheScreen();
  expect(screen.getByText(/^접수 시작 D-\d+$/)).toBeOnTheScreen();
  expect(screen.getByText('연기과')).toBeOnTheScreen();
  expect(screen.getByText('실기우수자전형')).toBeOnTheScreen();
  expect(screen.getByText('2099-01-02 ~ 2099-01-05')).toBeOnTheScreen();
  expect(screen.getByText('2099-02-01 ~ 2099-02-03')).toBeOnTheScreen();
  expect(screen.getByText('2099-03-01')).toBeOnTheScreen();
  expect(screen.getByText('20명')).toBeOnTheScreen();
  expect(screen.getByText('80,000원')).toBeOnTheScreen();
  expect(screen.getByText(/^2026-10-01 기준/)).toBeOnTheScreen();
});

test('반영비율·단계·실기 종목·요강 항목을 펼쳐 보인다', async () => {
  await loaded();

  expect(screen.getByText('실기 70%')).toBeOnTheScreen();
  expect(screen.getByText('학생부 30%')).toBeOnTheScreen();
  expect(screen.queryByText('수능 0%')).not.toBeOnTheScreen();
  expect(screen.getByText('면접은 실기에 포함')).toBeOnTheScreen();

  expect(screen.getAllByText(/^\d단계$/).map((n) => n.props.children.join(''))).toEqual(['1단계', '2단계', '3단계']);
  expect(screen.getByText('5배수')).toBeOnTheScreen();
  expect(screen.getByText('반영 100%')).toBeOnTheScreen();
  expect(screen.getByText('성적 미반영')).toBeOnTheScreen();
  expect(screen.getAllByText('노래')).toHaveLength(2);
  expect(screen.getByText('2099-02-03 · 자유연기, mime')).toBeOnTheScreen();
  expect(screen.getByText('2099-02-10')).toBeOnTheScreen();
  expect(screen.getByText('1차 성적 미반영')).toBeOnTheScreen();

  expect(screen.getByText('독백')).toBeOnTheScreen();
  expect(screen.getByText('1편 · 1분 30초 · 60% · 1단계')).toBeOnTheScreen();
  expect(screen.getByText('선택')).toBeOnTheScreen();
  expect(screen.getByText('1분')).toBeOnTheScreen();
  expect(screen.getByText('30초')).toBeOnTheScreen();
  expect(screen.getByText('현대극')).toBeOnTheScreen();

  for (const text of ['자유연기 1분 30초', '검은 옷', '수험표', '자기소개서', '없음', '· 햄릿', '· 갈매기', '1. 왜 배우인가', '2. 인생 작품', '모집요강 2026 기준']) {
    expect(screen.getByText(text)).toBeOnTheScreen();
  }
});

test('경쟁률이 있는 해만 전년도 결과로 보인다', async () => {
  await loaded();

  expect(screen.getByText('2025학년도 · 12.5:1 · 학생부 평균 3.2 · 실기 평균 85 · 충원율 120% · 예비 4번')).toBeOnTheScreen();
  expect(screen.getByText('2024학년도 · 10:1')).toBeOnTheScreen();
  expect(screen.queryByText(/^2023학년도/)).not.toBeOnTheScreen();
});

test('후기는 갈래별로 묶어 확인 건수와 출처를 보인다', async () => {
  await loaded();

  expect(screen.getByText('시험 당일')).toBeOnTheScreen();
  expect(screen.getByText('그 밖에')).toBeOnTheScreen();
  expect(screen.getByText('후기 3건')).toBeOnTheScreen();
  expect(screen.queryByText('후기 1건')).not.toBeOnTheScreen();
  expect(screen.getByText('네이버 블로그')).toBeOnTheScreen();
  expect(screen.getByText('forum')).toBeOnTheScreen();
  expect(screen.getByText('2025년 기준')).toBeOnTheScreen();
  expect(screen.getAllByText('출처 ↗')).toHaveLength(1);
});

test('참고 영상은 누가 올렸는지 표시한다', async () => {
  await loaded();

  expect(screen.getByText('대학 공식')).toBeOnTheScreen();
  expect(screen.getByText('입시학원')).toBeOnTheScreen();
  expect(screen.getByText('mystery')).toBeOnTheScreen();
  expect(screen.getAllByText('개인').length).toBe(2);
  expect(screen.getByText('연기학원')).toBeOnTheScreen();
});

test('링크를 누르면 원문을 연다', async () => {
  const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  await loaded();

  await fireEvent.press(screen.getByText('입학처 원문 ↗'));
  await fireEvent.press(screen.getByText('원문 공고 보기 ↗'));
  await fireEvent.press(screen.getByText('출처 ↗'));
  await fireEvent.press(screen.getByText('학원 시범'));

  expect(openURL.mock.calls).toEqual([['https://admission.example.ac.kr'], ['https://notice/1'], ['https://blog/1'], ['https://yt/3']]);
});

describe('일정 표시', () => {
  test.each([
    ['오늘 마감', { apply_start: '2020-01-01', apply_end: todayText() }, '접수 마감 D-DAY'],
    ['지난 전형', { apply_start: '2020-01-01', apply_end: '2020-01-10' }, '접수 마감'],
  ])('%s', async (_name, dates, label) => {
    byUniversity.mockResolvedValue(admissions({ universities: [uni], notices: [notice({ ...dates, discipline: 'dance' })] }));
    await loaded();

    expect(screen.getByText(label)).toBeOnTheScreen();
    expect(screen.getByText('dance')).toBeOnTheScreen();
    expect(screen.getByText('학과 미확인')).toBeOnTheScreen();
  });

  test('날짜를 모르면 일정 표시가 없다', async () => {
    byUniversity.mockResolvedValue(admissions({ universities: [uni], notices: [notice({ apply_end: null, apply_start: null })] }));
    await loaded();

    expect(screen.getByText('학과 미확인')).toBeOnTheScreen();
    expect(screen.queryByText(/접수/)).not.toBeOnTheScreen();
  });
});

test('반영비율 숫자가 없으면 설명만 보인다', async () => {
  byUniversity.mockResolvedValue(
    admissions({ universities: [uni], notices: [notice({ weights: null, weights_note: '실기 100% (추정)' })] }),
  );
  await loaded();

  expect(screen.getByText('전형요소 반영비율')).toBeOnTheScreen();
  expect(screen.getByText('실기 100% (추정)')).toBeOnTheScreen();
});

test('전형을 아직 확인하지 못했으면 대학 메모나 기본 안내를 보인다', async () => {
  byUniversity.mockResolvedValueOnce(admissions({ universities: [{ ...uni, note: '2027 요강 대기 중', tips: [], resources: [] }] }));
  const view = await render(<UniversityDetailScreen />);
  expect(await screen.findByText('2027 요강 대기 중')).toBeOnTheScreen();
  expect(screen.queryByText('먼저 다녀온 사람들 이야기')).not.toBeOnTheScreen();
  expect(screen.queryByText('참고 영상')).not.toBeOnTheScreen();
  await view.unmount();

  byUniversity.mockResolvedValueOnce(admissions({ universities: [university({ campus: null, type: 'univ' })] }));
  await render(<UniversityDetailScreen />);
  expect(await screen.findByText('아직 전형 정보를 확인하지 못했어요. 입학처 원문에서 확인해 주세요.')).toBeOnTheScreen();
  expect(screen.queryByText('전문대')).not.toBeOnTheScreen();
});

test('대학을 찾지 못하면 그렇다고 알리고 머리는 기본 제목이다', async () => {
  byUniversity.mockResolvedValue(admissions());
  await render(<UniversityDetailScreen />);

  expect(await screen.findByText('해당 대학을 찾을 수 없어요.')).toBeOnTheScreen();
  expect(screen.getByText('연기 입시 정보')).toBeOnTheScreen();
});

test('못 불러오면 그렇다고 알리고, 다시 시도하면 다시 읽는다', async () => {
  byUniversity.mockRejectedValueOnce(new Error('down'));
  await render(<UniversityDetailScreen />);
  expect(await screen.findByText('입시 정보를 불러오지 못했어요')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '다시 시도' }));
  expect(screen.queryByText('입시 정보를 불러오지 못했어요')).not.toBeOnTheScreen();
  expect(byUniversity).toHaveBeenCalledTimes(2);
});

test('대학 id 없이 열면 읽지 않는다', async () => {
  mockParams = {};
  await render(<UniversityDetailScreen />);
  expect(byUniversity).not.toHaveBeenCalled();
  expect(screen.getByText('연기 입시 정보')).toBeOnTheScreen();
});

test('뒤로는 이전 화면으로 간다', async () => {
  await loaded();
  await fireEvent.press(screen.getByRole('button', { name: '뒤로' }));
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
});
