import { render, screen } from '@testing-library/react-native';

import RecordTab from '@/app/(tabs)/record';

test('촬영 탭 자리는 아무것도 그리지 않는다 — 누르면 탭바가 카메라를 바로 연다', async () => {
  await render(<RecordTab />);

  expect(screen.toJSON()).toBeNull();
});
