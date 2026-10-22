import { fireEvent, render, screen } from '@testing-library/react-native';

import { ReadingExitSheet } from '@/components/reading-exit-sheet';
import { UploadWaitPanel } from '@/components/upload-wait-panel';

describe('ReadingExitSheet', () => {
  it('제목·본문·두 버튼을 보이고 각각 알린다', async () => {
    const onLeave = jest.fn();
    const onKeep = jest.fn();
    await render(<ReadingExitSheet visible body="읽은 데까지 저장돼요." onLeave={onLeave} onKeep={onKeep} />);
    expect(screen.getByText('리딩을 멈출까요?')).toBeTruthy();
    expect(screen.getByText('읽은 데까지 저장돼요.')).toBeTruthy();
    await fireEvent.press(screen.getByText('나가기'));
    expect(onLeave).toHaveBeenCalled();
    await fireEvent.press(screen.getByText('계속 읽기'));
    expect(onKeep).toHaveBeenCalled();
  });
});

describe('UploadWaitPanel', () => {
  it('올리는 중에는 홈에서 기다리기·올리기 취소', async () => {
    const onHome = jest.fn();
    const onCancel = jest.fn();
    await render(<UploadWaitPanel failed={false} onHome={onHome} onRetry={jest.fn()} onCancel={onCancel} />);
    expect(screen.getByText('영상을 올리고 있어요')).toBeTruthy();
    await fireEvent.press(screen.getByText('홈에서 기다리기'));
    await fireEvent.press(screen.getByText('올리기 취소'));
    expect(onHome).toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });

  it('실패하면 다시 올리기', async () => {
    const onRetry = jest.fn();
    await render(<UploadWaitPanel failed onHome={jest.fn()} onRetry={onRetry} onCancel={jest.fn()} />);
    await fireEvent.press(screen.getByText('다시 올리기'));
    expect(onRetry).toHaveBeenCalled();
  });
});
