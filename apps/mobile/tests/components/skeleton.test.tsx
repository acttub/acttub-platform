import { render, screen } from '@testing-library/react-native';

import { SkeletonCards, SkeletonDetail, SkeletonRows } from '@/components/ui/skeleton';

// 뼈대 화면(SOMA-828) — 화면을 열 때 로딩 표시 대신 보이는 회색 칸. 낭독기에는 「불러오는 중…」 하나로 읽힌다.
describe('뼈대 화면', () => {
  test('목록·카드·상세 뼈대가 모두 「불러오는 중…」으로 읽힌다', async () => {
    await render(
      <>
        <SkeletonRows count={3} />
        <SkeletonCards count={4} columns={2} />
        <SkeletonDetail media />
      </>,
    );
    expect(screen.getAllByTestId('skeleton')).toHaveLength(3);
    expect(screen.getAllByLabelText('불러오는 중…')).toHaveLength(3);
  });
});
