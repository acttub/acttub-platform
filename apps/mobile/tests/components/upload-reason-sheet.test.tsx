import { fireEvent, render, screen } from '@testing-library/react-native';
import { UploadReasonSheet } from '@/components/upload-reason-sheet';
import { UploadOptionsPage } from '@/components/upload-options-page';
import { UploadPrepareFailed } from '@/components/upload-prepare-failed';
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));
jest.mock('@expo/vector-icons/Feather', () => 'Feather');

const cb = () => ({ onFace: jest.fn(), onShort: jest.fn(), onLater: jest.fn() });
for (const [label, key] of [['얼굴·영상이 남는 게 걱정돼요', 'onFace'], ['길게 찍기 부담돼요', 'onShort'], ['지금은 못 찍어요', 'onLater']] as const) {
  test(`${key}: 고른 뒤 다음을 눌러야 넘어간다`, async () => {
    const props = cb();
    await render(<UploadReasonSheet {...props} />);
    await fireEvent.press(screen.getByText('다음'));
    expect(props[key]).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText(label));
    await fireEvent.press(screen.getByText('다음'));
    expect(props[key]).toHaveBeenCalledTimes(1);
  });
}

test('올리기 옵션: 기본은 영상 지우기 켜짐·얼굴 가리기 꺼짐, 토글한 값을 넘긴다', async () => {
  const onDone = jest.fn();
  await render(<UploadOptionsPage onDone={onDone} />);
  await fireEvent.press(screen.getByText('이대로 올리기'));
  expect(onDone).toHaveBeenLastCalledWith({ purgeAfterAnalysis: true, faceMosaic: false });
  await fireEvent(screen.getByLabelText('얼굴 가리기'), 'valueChange', true);
  await fireEvent(screen.getByLabelText('분석 끝나면 영상 바로 지우기'), 'valueChange', false);
  await fireEvent.press(screen.getByText('이대로 올리기'));
  expect(onDone).toHaveBeenLastCalledWith({ purgeAfterAnalysis: false, faceMosaic: true });
});

test('압축 실패: 다시 시도와 다른 영상 고르기', async () => {
  const onRetry = jest.fn(); const onOther = jest.fn();
  await render(<UploadPrepareFailed onRetry={onRetry} onOther={onOther} />);
  expect(screen.getByText('영상을 준비하지 못했어요')).toBeTruthy();
  await fireEvent.press(screen.getByText('다시 시도')); expect(onRetry).toHaveBeenCalled();
  await fireEvent.press(screen.getByText('다른 영상 고르기')); expect(onOther).toHaveBeenCalled();
});
