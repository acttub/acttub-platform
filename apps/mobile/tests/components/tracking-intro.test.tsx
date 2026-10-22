import { fireEvent, render, screen } from '@testing-library/react-native';
import { TrackingIntro } from '@/components/tracking-intro';
test('explains optional tracking and continues without promising rewards',async()=>{const onContinue=jest.fn();await render(<TrackingIntro visible onContinue={onContinue} onDismiss={jest.fn()} />);expect(screen.getByText('허용하지 않아도 모든 기능은 똑같이 쓸 수 있어요.')).toBeTruthy();await fireEvent.press(screen.getByText('계속'));expect(onContinue).toHaveBeenCalledTimes(1);});
