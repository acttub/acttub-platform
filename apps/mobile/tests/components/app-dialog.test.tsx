import { useState } from 'react';
import Feather from '@expo/vector-icons/Feather';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { type DialogAction, useAppDialog } from '@/components/app-dialog';

// 첫 테스트가 Modal 을 처음 변환·그리며 다른 작업과 겹치면 기본 5초를 넘긴다(측정: 단독 5.0초, 병렬 실행에서 시간 초과).
jest.setTimeout(20_000);

type Open = (dialog: ReturnType<typeof useAppDialog>) => Promise<boolean>;

// 화면이 쓰는 그대로 — 버튼으로 다이얼로그를 열고, 받은 답을 화면에 적는다.
function Screen({ open }: { open: Open }) {
  const dialog = useAppDialog();
  const [answer, setAnswer] = useState('없음');
  return (
    <View>
      <Pressable accessibilityRole="button" onPress={() => void open(dialog).then((v) => setAnswer(String(v)))}>
        <Text>열기</Text>
      </Pressable>
      <Text>{`답: ${answer}`}</Text>
      {dialog.dialog}
    </View>
  );
}

async function openWith(open: Open) {
  await render(<Screen open={open} />);
  await fireEvent.press(screen.getByRole('button', { name: '열기' }));
}

const modal = () => screen.container.queryAll((node) => typeof node.props.onRequestClose === 'function')[0];
const backdrop = () => modal().children[0] as Parameters<typeof fireEvent.press>[0];
const inside = { stopPropagation: jest.fn() };

test('확인 창은 제목·설명과 기본 취소·확인을 보이고, 확인을 누르면 true 로 닫힌다', async () => {
  await openWith((d) => d.confirm({ title: '삭제할까요?', message: '되돌릴 수 없어요' }));

  expect(screen.getByText('삭제할까요?')).toBeOnTheScreen();
  expect(screen.getByText('되돌릴 수 없어요')).toBeOnTheScreen();
  expect(screen.getByText('취소')).toBeOnTheScreen();

  await fireEvent.press(screen.getByText('확인'));

  expect(screen.getByText('답: true')).toBeOnTheScreen();
  expect(screen.queryByText('삭제할까요?')).toBeNull();
});

test('확인 창에서 고쳐 쓴 취소를 누르면 false 로 닫힌다', async () => {
  await openWith((d) => d.confirm({ title: '나갈까요?', confirmLabel: '나가기', cancelLabel: '머무르기', destructive: true }));

  expect(screen.queryByText('확인')).toBeNull();
  expect(screen.getByText('나가기')).toBeOnTheScreen();

  await fireEvent.press(screen.getByText('머무르기'));

  expect(screen.getByText('답: false')).toBeOnTheScreen();
  expect(screen.queryByText('나갈까요?')).toBeNull();
});

test('카드 안을 눌러도 닫히지 않고, 배경을 누르면 false 로 닫힌다', async () => {
  await openWith((d) => d.confirm({ title: '저장할까요?' }));

  await fireEvent.press(screen.getByText('저장할까요?'), inside);
  expect(screen.getByText('저장할까요?')).toBeOnTheScreen();
  expect(screen.getByText('답: 없음')).toBeOnTheScreen();

  await fireEvent.press(backdrop());

  expect(screen.getByText('답: false')).toBeOnTheScreen();
  expect(screen.queryByText('저장할까요?')).toBeNull();
});

test('알림 창은 취소 없이 확인 하나만 두고, 설명이 없으면 제목만 보인다', async () => {
  await openWith((d) => d.alert({ title: '저장했어요', confirmLabel: '좋아요' }));

  expect(screen.getByText('저장했어요')).toBeOnTheScreen();
  expect(screen.queryByText('취소')).toBeNull();

  await fireEvent.press(screen.getByText('좋아요'));

  expect(screen.getByText('답: true')).toBeOnTheScreen();
});

test('뒤로 가기로 닫으면 false 다', async () => {
  await openWith((d) => d.alert({ title: '알림' }));

  await fireEvent(modal(), 'requestClose');

  expect(screen.getByText('답: false')).toBeOnTheScreen();
  expect(screen.queryByText('알림')).toBeNull();
});

test('선택 시트는 제목 쪽을 눌러도 닫히지 않고, 고른 항목은 닫은 뒤 그 동작을 실행하고 true 를 준다', async () => {
  const report = jest.fn();
  const actions: DialogAction[] = [{ label: '신고하기', onPress: report, destructive: true }, { label: '공유하기' }];
  await openWith((d) => d.sheet({ title: '더보기', actions }));

  expect(screen.getByText('더보기')).toBeOnTheScreen();
  expect(screen.getByText('공유하기')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('더보기'), inside);
  expect(screen.getByText('답: 없음')).toBeOnTheScreen();

  await fireEvent.press(screen.getByText('신고하기'));

  expect(report.mock.calls).toEqual([[]]);
  expect(screen.getByText('답: true')).toBeOnTheScreen();
  expect(screen.queryByText('더보기')).toBeNull();
});

test('동작이 없는 항목도 true 로 닫힌다', async () => {
  await openWith((d) => d.sheet({ actions: [{ label: '공유하기' }] }));

  await fireEvent.press(screen.getByText('공유하기'));

  expect(screen.getByText('답: true')).toBeOnTheScreen();
});

test('메뉴에는 취소 줄이 없고, 바깥을 누르면 false 로 닫힌다', async () => {
  const report = jest.fn();
  await openWith((d) => d.sheet({ actions: [{ label: '신고하기', onPress: report }] }));

  expect(screen.queryByText('취소')).toBeNull();
  await fireEvent.press(backdrop());

  expect(screen.getByText('답: false')).toBeOnTheScreen();
  expect(screen.queryByText('신고하기')).toBeNull();
  expect(report.mock.calls).toEqual([]);
});

test('anchor 를 주면 누른 점 근처에, 없으면 오른쪽 위에 메뉴가 뜬다', async () => {
  await openWith((d) => d.sheet({ actions: [{ label: '삭제' }], anchor: { x: 200, y: 300 } }));
  const flat = (style: unknown) => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
  const near = flat(screen.getByTestId('anchored-menu').props.style);
  expect(near.top).toBe(308);
  expect(near.left).toBeGreaterThan(0);
  expect(near.left + near.width).toBeGreaterThan(200);
  expect(near.left).toBeLessThan(200);
  await fireEvent.press(backdrop());
  expect(screen.queryByText('삭제')).toBeNull();
});

test('메뉴 항목은 아이콘을 앞에 둘 수 있고, 지우기 줄은 아이콘도 빨갛다(pen R1.6)', async () => {
  // 아이콘 글꼴은 글자 하나로 그려진다 — 같은 이름의 글자를 먼저 얻는다.
  const glyphOf = async (name: 'edit-2' | 'trash-2') => {
    const icon = await render(<Feather name={name} size={18} />);
    const glyph = (JSON.parse(JSON.stringify(icon.toJSON())) as { children: string[] }).children[0];
    await icon.unmount();
    return glyph;
  };
  const pencil = await glyphOf('edit-2');
  const trash = await glyphOf('trash-2');
  await openWith((d) =>
    d.sheet({
      actions: [
        { label: '제목 수정', icon: 'edit-2' },
        { label: '대본 삭제', icon: 'trash-2', destructive: true },
      ],
    }),
  );

  expect(screen.getByText(pencil)).toBeOnTheScreen();
  expect(StyleSheet.flatten(screen.getByText(trash).props.style).color).toBe('#E42939');
  expect(screen.getByRole('button', { name: '제목 수정' })).toBeOnTheScreen();
});
