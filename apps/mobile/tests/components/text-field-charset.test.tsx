import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';

import { TextField } from '@/components/ui/text-field';

const STACKED = 'Z\u0325\u031c\u0318\u0316\u0323\u0344\u0303a';

function Harness({ charset, secure }: { charset?: 'strict' | 'loose' | 'off'; secure?: boolean }) {
  const [value, setValue] = useState('');
  return <TextField label="칸" value={value} onChangeText={setValue} charset={charset} secureTextEntry={secure} />;
}

describe('TextField 허용 글자 범위(SOMA-922)', () => {
  test('기본(strict)은 범위 밖 글자를 빼고 한 줄로 알린다', async () => {
    await render(<Harness />);
    await fireEvent.changeText(screen.getByLabelText('칸'), '안녕こんにちは');
    expect(screen.getByLabelText('칸').props.value).toBe('안녕');
    expect(screen.getByText('읽을 수 없는 글자는 빼고 넣었어요.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('칸'), '안녕하세요');
    expect(screen.queryByText('읽을 수 없는 글자는 빼고 넣었어요.')).toBeNull();
  });

  test('loose 는 일본어·중국어를 받고 쌓은 결합 기호만 뺀다', async () => {
    await render(<Harness charset="loose" />);
    await fireEvent.changeText(screen.getByLabelText('칸'), '안녕 こんにちは 你好');
    expect(screen.getByLabelText('칸').props.value).toBe('안녕 こんにちは 你好');
    await fireEvent.changeText(screen.getByLabelText('칸'), STACKED);
    expect(screen.getByLabelText('칸').props.value).toBe('Z\u0325\u031c\u0318\u0316a');
  });

  test('비밀번호 칸은 건드리지 않는다', async () => {
    await render(<Harness secure />);
    await fireEvent.changeText(screen.getByLabelText('칸'), 'ぱすわーど1');
    expect(screen.getByLabelText('칸').props.value).toBe('ぱすわーど1');
  });
});
