import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Share } from 'react-native';

import PortfolioEditScreen from '@/app/portfolio-edit';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api-request';
import type { Portfolio, PortfolioCredit } from '@/lib/portfolio';
import { pickAndUploadPortfolioPhoto } from '@/lib/profile-photo-upload';

jest.mock('expo-router', () => ({ Stack: { Screen: () => null } }));
jest.mock('@/lib/api', () => ({
  api: {
    portfolio: jest.fn(),
    savePortfolioIntro: jest.fn(),
    createPortfolioCredit: jest.fn(),
    updatePortfolioCredit: jest.fn(),
    deletePortfolioCredit: jest.fn(),
    reorderPortfolioCredits: jest.fn(),
    deletePortfolioPhoto: jest.fn(),
    reorderPortfolioPhotos: jest.fn(),
    setPortfolioShare: jest.fn(),
  },
}));
jest.mock('@/lib/profile-photo-upload', () => ({ pickAndUploadPortfolioPhoto: jest.fn() }));

const a = api as unknown as Record<string, jest.Mock>;

const hamlet: PortfolioCredit = { id: 'c1', title: '햄릿', role: '햄릿 역', year: 2023, kind: 'play' };
const drama: PortfolioCredit = { id: 'c2', title: '봄날', role: '친구 역', year: 2024, kind: 'drama' };

function portfolio(overrides: Partial<Portfolio> = {}): Portfolio {
  return {
    intro: '안녕하세요',
    credits: [hamlet, drama],
    photos: [
      { id: 'ph1', url: 'https://cdn/1.jpg' },
      { id: 'ph2', url: null },
    ],
    share: { enabled: false, slug: null, url: null },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  a.portfolio.mockResolvedValue(portfolio());
});

const buttons = (name: string) => screen.getAllByRole('button', { name });

async function loaded() {
  await render(<PortfolioEditScreen />);
  await screen.findByText('햄릿');
}

test('소개글·경력·사진·공유 상태를 보여 준다', async () => {
  await loaded();

  expect(screen.getByDisplayValue('안녕하세요')).toBeOnTheScreen();
  expect(screen.getByText('5 / 2000')).toBeOnTheScreen();
  expect(screen.getByText('햄릿 역 · 2023 · 연극')).toBeOnTheScreen();
  expect(screen.getByText('친구 역 · 2024 · 드라마')).toBeOnTheScreen();
  expect(screen.getByText('2 / 50')).toBeOnTheScreen();
  expect(screen.getByLabelText('1번째 사진')).toBeOnTheScreen();
  expect(screen.getByText('2 / 10')).toBeOnTheScreen();
  expect(screen.getByText('지금은 꺼져 있어 아무도 볼 수 없어요. 다시 켜면 같은 주소가 열려요.')).toBeOnTheScreen();
  expect(buttons('위로 옮기기')[0]).toBeDisabled();
  expect(buttons('아래로 옮기기')[1]).toBeDisabled();
  expect(screen.getByRole('button', { name: '저장' })).toBeDisabled();
});

test('비어 있으면 빈 안내를 보인다', async () => {
  a.portfolio.mockResolvedValue(portfolio({ intro: null, credits: [], photos: [] }));
  await render(<PortfolioEditScreen />);

  expect(await screen.findByText('아직 적은 경력이 없어요.')).toBeOnTheScreen();
  expect(screen.getByText('아직 올린 사진이 없어요.')).toBeOnTheScreen();
  expect(screen.getByText('0 / 2000')).toBeOnTheScreen();
});

test.each([
  [new Error('네트워크 오류'), '네트워크 오류'],
  ['boom', '포트폴리오를 불러오지 못했어요.'],
])('못 불러오면 이유와 다시 불러오기를 둔다 (%#)', async (cause, message) => {
  a.portfolio.mockRejectedValueOnce(cause);
  await render(<PortfolioEditScreen />);

  expect(await screen.findByText(message)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '다시 불러오기' }));
  expect(await screen.findByText('햄릿')).toBeOnTheScreen();
});

describe('소개글', () => {
  test('바꾸면 저장할 수 있고 다듬어 보낸다', async () => {
    a.savePortfolioIntro.mockResolvedValue(portfolio({ intro: '무대 배우입니다' }));
    await loaded();

    await fireEvent.changeText(screen.getByDisplayValue('안녕하세요'), '  무대 배우입니다 ');
    await fireEvent.press(screen.getByRole('button', { name: '저장' }));

    expect(a.savePortfolioIntro).toHaveBeenCalledWith('무대 배우입니다');
    expect(await screen.findByDisplayValue('무대 배우입니다')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled();
  });

  test('비우면 소개글을 지운다', async () => {
    a.savePortfolioIntro.mockResolvedValue(portfolio({ intro: null }));
    await loaded();

    await fireEvent.changeText(screen.getByDisplayValue('안녕하세요'), '   ');
    await fireEvent.press(screen.getByRole('button', { name: '저장' }));
    expect(a.savePortfolioIntro).toHaveBeenCalledWith(null);
  });

  test('2,000자를 넘으면 알리고 막는다', async () => {
    await loaded();
    await fireEvent.changeText(screen.getByDisplayValue('안녕하세요'), '가'.repeat(2001));

    expect(screen.getByText('소개글은 2,000자까지 쓸 수 있어요.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled();
  });

  test('저장하는 동안 다른 버튼도 막는다', async () => {
    let finish!: (v: Portfolio) => void;
    a.savePortfolioIntro.mockReturnValue(new Promise((r) => (finish = r)));
    await loaded();

    await fireEvent.changeText(screen.getByDisplayValue('안녕하세요'), '새 소개');
    // saveIntro 가 돌려주는 약속을 fireEvent 가 기다리므로 끝나기 전에 상태를 본다.
    const pressing = fireEvent.press(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '경력 추가' })).toBeDisabled());
    expect(buttons('삭제')[0]).toBeDisabled();

    await act(async () => finish(portfolio({ intro: '새 소개' })));
    await pressing;
    expect(screen.getByRole('button', { name: '경력 추가' })).toBeEnabled();
  });
});

describe('경력', () => {
  test('비워 두고 저장하면 칸마다 입력하라고 한다', async () => {
    await loaded();
    await fireEvent.press(screen.getByRole('button', { name: '경력 추가' }));
    expect(screen.getAllByText('경력 추가')).toHaveLength(2);

    const dialogSave = buttons('저장');
    await fireEvent.press(dialogSave[dialogSave.length - 1]);

    expect(screen.getAllByText('입력해주세요.')).toHaveLength(4);
    expect(a.createPortfolioCredit).not.toHaveBeenCalled();
  });

  test('새 경력을 채워 저장하면 만들고 목록을 다시 받는다', async () => {
    a.createPortfolioCredit.mockResolvedValue(undefined);
    await loaded();
    await fireEvent.press(screen.getByRole('button', { name: '경력 추가' }));

    const [titleInput, roleInput, yearInput] = screen.getAllByDisplayValue('');
    await fireEvent.changeText(titleInput, ' 기생충 ');
    await fireEvent.changeText(roleInput, '기정 친구');
    await fireEvent.changeText(yearInput, '20a19');
    expect(screen.getByDisplayValue('2019')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: '영화' }));
    expect(screen.getByRole('button', { name: '영화' })).toBeSelected();
    a.portfolio.mockResolvedValue(portfolio({ credits: [hamlet, drama, { id: 'c3', title: '기생충', role: '기정 친구', year: 2019, kind: 'film' }] }));
    const dialogSave = buttons('저장');
    await fireEvent.press(dialogSave[dialogSave.length - 1]);

    expect(a.createPortfolioCredit).toHaveBeenCalledWith({ title: '기생충', role: '기정 친구', year: 2019, kind: 'film' });
    expect(await screen.findByText('기정 친구 · 2019 · 영화')).toBeOnTheScreen();
    expect(screen.queryByText('작품명')).not.toBeOnTheScreen();
  });

  test('저장하는 동안 대화상자의 저장을 막는다', async () => {
    let finish!: () => void;
    a.updatePortfolioCredit.mockReturnValue(new Promise<void>((r) => (finish = r)));
    await loaded();
    await fireEvent.press(buttons('수정')[0]);
    await fireEvent.changeText(screen.getByDisplayValue('햄릿 역'), '호레이쇼 역');
    const dialogSave = buttons('저장');
    await fireEvent.press(dialogSave[dialogSave.length - 1]);

    expect(screen.getAllByText('저장')).toHaveLength(1);
    expect(buttons('수정')[0]).toBeDisabled();
    await act(async () => finish());
    expect(screen.queryByText('경력 수정')).not.toBeOnTheScreen();
  });

  test('연도가 범위를 벗어나면 알린다', async () => {
    await loaded();
    await fireEvent.press(screen.getByRole('button', { name: '경력 추가' }));
    const [, , yearInput] = screen.getAllByDisplayValue('');
    await fireEvent.changeText(yearInput, '1800');
    const dialogSave = buttons('저장');
    await fireEvent.press(dialogSave[dialogSave.length - 1]);

    expect(screen.getByText('1900년부터 내년까지의 연도를 네 자리로 적어주세요.')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByDisplayValue('1800'), '2001');
    expect(screen.queryByText('1900년부터 내년까지의 연도를 네 자리로 적어주세요.')).not.toBeOnTheScreen();
  });

  test('고치면 바뀐 칸만 보내고, 바뀐 게 없으면 보내지 않는다', async () => {
    a.updatePortfolioCredit.mockResolvedValue(undefined);
    await loaded();

    await fireEvent.press(buttons('수정')[0]);
    expect(screen.getByText('경력 수정')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByDisplayValue('햄릿 역'), '호레이쇼 역');
    await fireEvent.press(screen.getByRole('button', { name: '드라마' }));
    let dialogSave = buttons('저장');
    await fireEvent.press(dialogSave[dialogSave.length - 1]);
    expect(a.updatePortfolioCredit).toHaveBeenCalledWith('c1', { role: '호레이쇼 역', kind: 'drama' });

    await waitFor(() => expect(screen.queryByText('경력 수정')).not.toBeOnTheScreen());
    await fireEvent.press(buttons('수정')[1]);
    dialogSave = buttons('저장');
    await fireEvent.press(dialogSave[dialogSave.length - 1]);
    expect(a.updatePortfolioCredit).toHaveBeenCalledTimes(1);
    expect(a.portfolio).toHaveBeenCalledTimes(3);
  });

  test('취소나 바깥을 누르면 닫는다', async () => {
    await loaded();
    await fireEvent.press(screen.getByRole('button', { name: '경력 추가' }));
    await fireEvent.press(screen.getByRole('button', { name: '취소' }));
    expect(screen.queryByText('작품명')).not.toBeOnTheScreen();

    await fireEvent.press(buttons('수정')[0]);
    expect(screen.getByText('경력 수정')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: '' }));
    expect(screen.queryByText('경력 수정')).not.toBeOnTheScreen();

    await fireEvent.press(buttons('수정')[1]);
    await fireEvent(screen.getByText('경력 수정'), 'requestClose');
    expect(screen.queryByText('경력 수정')).not.toBeOnTheScreen();
  });

  test('지우기는 확인 뒤 지우고 다시 받는다', async () => {
    a.deletePortfolioCredit.mockResolvedValue(undefined);
    await loaded();

    await fireEvent.press(buttons('삭제')[0]);
    expect(await screen.findByText('이 경력을 지울까요?')).toBeOnTheScreen();
    const labels = screen.getAllByText('삭제');
    await fireEvent.press(labels[labels.length - 1]);

    expect(a.deletePortfolioCredit).toHaveBeenCalledWith('c1');
    expect(a.portfolio).toHaveBeenCalledTimes(2);
  });

  test('지우기를 취소하면 보내지 않는다', async () => {
    await loaded();
    await fireEvent.press(buttons('삭제')[1]);
    await fireEvent.press(await screen.findByText('취소'));
    expect(a.deletePortfolioCredit).not.toHaveBeenCalled();
    expect(screen.getByText('봄날')).toBeOnTheScreen();
  });

  test('아래로 옮기면 바뀐 순서를 보낸다', async () => {
    a.reorderPortfolioCredits.mockResolvedValue(portfolio({ credits: [drama, hamlet] }));
    await loaded();

    await fireEvent.press(buttons('아래로 옮기기')[0]);

    expect(a.reorderPortfolioCredits).toHaveBeenCalledWith({ ids: ['c2', 'c1'] });
    await waitFor(() =>
      expect(screen.getAllByText(/ 역 · /).map((n) => n.props.children)).toEqual(['친구 역 · 2024 · 드라마', '햄릿 역 · 2023 · 연극']),
    );
  });

  test('위로 옮기면 바뀐 순서를 보낸다', async () => {
    a.reorderPortfolioCredits.mockResolvedValue(portfolio({ credits: [drama, hamlet] }));
    await loaded();
    await fireEvent.press(buttons('위로 옮기기')[1]);
    expect(a.reorderPortfolioCredits).toHaveBeenCalledWith({ ids: ['c2', 'c1'] });
  });

  test('50개면 더 넣을 수 없다고 알린다', async () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ ...hamlet, id: `c${i}`, title: `작품${i}` }));
    a.portfolio.mockResolvedValue(portfolio({ credits: many }));
    await render(<PortfolioEditScreen />);

    expect(await screen.findByText('경력은 50개까지 넣을 수 있어요.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: '경력 추가' })).toBeDisabled();
  });
});

describe('사진', () => {
  test('추가한 사진으로 갈아 끼우고, 고르지 않으면 그대로 둔다', async () => {
    (pickAndUploadPortfolioPhoto as jest.Mock)
      .mockResolvedValueOnce(portfolio({ photos: [{ id: 'ph1', url: null }, { id: 'ph2', url: null }, { id: 'ph3', url: null }] }))
      .mockResolvedValueOnce(null);
    await loaded();

    await fireEvent.press(screen.getByRole('button', { name: '사진 추가' }));
    expect(await screen.findByLabelText('3번째 사진')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: '사진 추가' }));
    expect(screen.getByText('3 / 10')).toBeOnTheScreen();
  });

  test('지우기는 확인 뒤 지우고, 위로 옮기면 순서를 보낸다', async () => {
    a.deletePortfolioPhoto.mockResolvedValue(undefined);
    a.reorderPortfolioPhotos.mockResolvedValue(portfolio());
    await loaded();

    await fireEvent.press(buttons('삭제')[3]);
    expect(await screen.findByText('이 사진을 지울까요?')).toBeOnTheScreen();
    const labels = screen.getAllByText('삭제');
    await fireEvent.press(labels[labels.length - 1]);
    expect(a.deletePortfolioPhoto).toHaveBeenCalledWith('ph2');

    await waitFor(() => expect(buttons('위로 옮기기')[3]).toBeEnabled());
    await fireEvent.press(buttons('위로 옮기기')[3]);
    expect(a.reorderPortfolioPhotos).toHaveBeenCalledWith({ ids: ['ph2', 'ph1'] });
  });

  test('아래로 옮기면 사진 순서를 보낸다', async () => {
    a.reorderPortfolioPhotos.mockResolvedValue(portfolio());
    await loaded();
    await fireEvent.press(buttons('아래로 옮기기')[2]);
    expect(a.reorderPortfolioPhotos).toHaveBeenCalledWith({ ids: ['ph2', 'ph1'] });
  });

  test('사진 지우기를 취소하면 보내지 않는다', async () => {
    await loaded();
    await fireEvent.press(buttons('삭제')[2]);
    await fireEvent.press(await screen.findByText('취소'));
    expect(a.deletePortfolioPhoto).not.toHaveBeenCalled();
    expect(screen.getByLabelText('2번째 사진')).toBeOnTheScreen();
  });

  test('10장이면 더 넣을 수 없다고 알린다', async () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ id: `ph${i}`, url: null }));
    a.portfolio.mockResolvedValue(portfolio({ photos: many }));
    await render(<PortfolioEditScreen />);

    expect(await screen.findByText('사진은 10장까지 넣을 수 있어요.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: '사진 추가' })).toBeDisabled();
  });
});

describe('공유 링크', () => {
  test('켜면 서버가 준 주소를 보이고 OS 공유 창으로 보낸다', async () => {
    const share = jest.spyOn(Share, 'share').mockRejectedValue(new Error('dismissed'));
    a.setPortfolioShare.mockResolvedValue({ enabled: true, slug: 'minji', url: 'https://acttub.app/p/minji' });
    await loaded();

    await fireEvent(screen.getByRole('switch'), 'valueChange', true);

    expect(a.setPortfolioShare).toHaveBeenCalledWith(true);
    expect(await screen.findByText('https://acttub.app/p/minji')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: '주소 보내기·복사' }));
    expect(share).toHaveBeenCalledWith({ message: 'https://acttub.app/p/minji' });
  });
});

describe('저장이 실패하면', () => {
  test.each([
    [new ApiError(422, 'order', 'order_mismatch'), '다른 기기에서 목록이 바뀌었어요. 다시 불러왔으니 순서를 다시 골라주세요.', 2],
    [new ApiError(413, 'big', 'upload_too_large'), '사진이 너무 커서 올리지 못했어요. 다른 사진으로 시도해주세요.', 1],
    [new ApiError(422, 'bad', 'validation_failed', [{ field: 'x' }]), '입력값을 저장하지 못했어요. 앱을 최신 버전으로 업데이트한 뒤 다시 시도해주세요.', 1],
    [new Error('연결이 끊겼어요'), '연결이 끊겼어요', 1],
    ['boom', '잠시 후 다시 시도해주세요.', 1],
  ])('사유 %#를 알리고 필요하면 다시 받는다', async (cause, message, loads) => {
    a.reorderPortfolioCredits.mockRejectedValue(cause);
    await loaded();

    await fireEvent.press(buttons('아래로 옮기기')[0]);

    expect(await screen.findByText('저장하지 못했어요')).toBeOnTheScreen();
    expect(screen.getByText(message)).toBeOnTheScreen();
    expect(a.portfolio).toHaveBeenCalledTimes(loads);
  });
});
