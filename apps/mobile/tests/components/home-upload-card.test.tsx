import { fireEvent, render, screen } from '@testing-library/react-native';

import { HomeUploadCard } from '@/components/home-upload-card';

const waiting = {
  owner: 'u1',
  pendingId: 'p1',
  videoId: null,
  requestId: 'r1',
  continueFrom: null,
  scene: { situation: '카페, 헤어지자는 말', character: '', goal: '' },
  blockage: { category: null, detail: null, note: '' },
  savedAt: 1,
};
const make = (state: 'uploading' | 'ready' | 'failed', extra = {}) => ({
  card: { state, waiting },
  error: null,
  busy: false,
  retry: jest.fn(),
  begin: jest.fn(),
  cancel: jest.fn(),
  ...extra,
});

describe('HomeUploadCard', () => {
  it('카드가 없으면 그리지 않는다', async () => {
    await render(<HomeUploadCard upload={{ ...make('uploading'), card: null }} />);
    expect(screen.queryByTestId('home-upload-card')).toBeNull();
  });

  it('올리는 중에는 제목과 올리는 중 버튼(비활성)을 보인다', async () => {
    const upload = make('uploading');
    await render(<HomeUploadCard upload={upload} />);
    expect(screen.getByText('올리는 중')).toBeTruthy();
    expect(screen.getByText('카페, 헤어지자는 말')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('올리는 중…'));
    expect(upload.begin).not.toHaveBeenCalled();
    expect(upload.retry).not.toHaveBeenCalled();
  });

  it('다 올라가면 질문 받기를 눌러 코칭을 시작한다', async () => {
    const upload = make('ready');
    await render(<HomeUploadCard upload={upload} />);
    await fireEvent.press(screen.getByText('영상 다 봤어요 · 질문 받기'));
    expect(upload.begin).toHaveBeenCalledTimes(1);
  });

  it('실패하면 다시 올리기 길을 준다', async () => {
    const upload = make('failed');
    await render(<HomeUploadCard upload={upload} />);
    expect(screen.getByText('올리기 실패')).toBeTruthy();
    await fireEvent.press(screen.getByText('다시 올리기'));
    expect(upload.retry).toHaveBeenCalledTimes(1);
  });

  it('시작 오류는 보조 줄 자리에 보인다', async () => {
    await render(<HomeUploadCard upload={make('ready', { error: '오늘은 여기까지예요' })} />);
    expect(screen.getByText('오늘은 여기까지예요')).toBeTruthy();
  });
});
