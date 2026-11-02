import { openResume } from '@/lib/reading/resume-open';
import { fetchSession, listSessions, loadIntoCurrent, setCurrentSession } from '@/lib/reading/store';

jest.mock('@/lib/reading/store', () => ({
  loadIntoCurrent: jest.fn(),
  listSessions: jest.fn(),
  fetchSession: jest.fn(),
  setCurrentSession: jest.fn(),
}));

const load = loadIntoCurrent as jest.Mock;
const list = listSessions as jest.Mock;
const fetchOne = fetchSession as jest.Mock;
const setCurrent = setCurrentSession as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  load.mockResolvedValue({ id: 's1' });
});

describe('이어 읽기 열기 (SOMA-994)', () => {
  test('회차를 모르면 진행 중 회차를 찾아 그 회차를 현재 회차로 두고 리딩 화면을 연다', async () => {
    list.mockResolvedValue([
      { id: 'done', status: 'done', progress: { done: 21, total: 21 } },
      { id: 'open', status: 'in_progress', progress: { done: 2, total: 21 } },
    ]);
    fetchOne.mockResolvedValue({ id: 'open' });
    await expect(openResume('s1')).resolves.toBe('play');
    expect(fetchOne).toHaveBeenCalledWith('open');
    expect(setCurrent).toHaveBeenCalledWith({ id: 'open' });
  });

  test('회차 id 를 알면 목록을 다시 받지 않고 그 회차를 연다', async () => {
    fetchOne.mockResolvedValue({ id: 'known' });
    await expect(openResume('s1', 'known')).resolves.toBe('play');
    expect(list).not.toHaveBeenCalled();
    expect(fetchOne).toHaveBeenCalledWith('known');
  });

  test('이을 회차가 없으면 대본 상세로 보낸다(새 회차를 만들지 않는다)', async () => {
    list.mockResolvedValue([{ id: 'done', status: 'done', progress: { done: 21, total: 21 } }]);
    await expect(openResume('s1')).resolves.toBe('detail');
    expect(fetchOne).not.toHaveBeenCalled();
    expect(setCurrent).not.toHaveBeenCalled();
  });

  test('회차 목록이나 회차를 못 받으면 대본 상세로 보낸다', async () => {
    list.mockRejectedValue(new Error('offline'));
    await expect(openResume('s1')).resolves.toBe('detail');
    list.mockResolvedValue([{ id: 'open', status: 'in_progress', progress: { done: 1, total: 3 } }]);
    fetchOne.mockRejectedValue(new Error('500'));
    await expect(openResume('s1')).resolves.toBe('detail');
    expect(setCurrent).not.toHaveBeenCalled();
  });

  test('대본을 못 열면 missing', async () => {
    load.mockResolvedValue(null);
    await expect(openResume('s1')).resolves.toBe('missing');
    expect(list).not.toHaveBeenCalled();
  });
});
