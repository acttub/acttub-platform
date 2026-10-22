import { fireEvent, render, screen } from '@testing-library/react-native';
import { UploadReasonSheet } from '@/components/upload-reason-sheet';
import { logEvent } from '@/lib/analytics';
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));
jest.mock('@expo/vector-icons/Feather', () => 'Feather');
const callbacks = () => ({onClose: jest.fn(), onTalk: jest.fn(), onScript: jest.fn(), onRecord: jest.fn()});
for (const [label,reason] of [['아직 찍어 둔 영상이 없어요','no_video'],['얼굴을 보이기가 부담스러워요','privacy'],['다른 이유가 있어요','other']]) {
 test(`reason ${reason} logs and offers existing routes`, async () => {
  const props=callbacks(); await render(<UploadReasonSheet {...props} />);
  await fireEvent.press(screen.getByText(label));
  expect(logEvent).toHaveBeenCalledWith('practice_upload_decline_reason',{reason});
  await fireEvent.press(screen.getByText('영상 없이 말로 코칭 받기')); expect(props.onTalk).toHaveBeenCalled();
  await fireEvent.press(screen.getByText('찍을 대사부터 같이 만들기')); expect(props.onScript).toHaveBeenCalled();
  await fireEvent.press(screen.getByText('지금 찍기')); expect(props.onRecord).toHaveBeenCalled();
  if(reason==='privacy') expect(screen.getByText(/코칭 영상은 다른 사용자에게 공개되지/)).toBeTruthy();
 });
}
test('skippable before choosing a reason',async()=>{const props=callbacks();await render(<UploadReasonSheet {...props}/>);await fireEvent.press(screen.getByText('지금은 넘어갈게요'));expect(props.onClose).toHaveBeenCalled();});
