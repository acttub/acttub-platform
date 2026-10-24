import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import {
  DEFAULT_AVATAR_COLORS,
  DEFAULT_AVATAR_GONE,
  DEFAULT_AVATAR_MINT,
  DefaultAvatar,
  defaultAvatarColor,
} from '@/components/ui/default-avatar';

describe('기본 얼굴(pen P/DefaultAvatar)', () => {
  test('seed 가 없으면 Mint, 있으면 여덟 색 중 하나를 늘 같게 고른다', () => {
    expect(defaultAvatarColor(null)).toBe(DEFAULT_AVATAR_MINT);
    expect(defaultAvatarColor('')).toBe('#A6D6C5');
    const color = defaultAvatarColor('user-1');
    expect(DEFAULT_AVATAR_COLORS).toContain(color);
    expect(defaultAvatarColor('user-1')).toBe(color);
  });

  test('84 는 모서리 32, 44 동그라미는 넘긴 모서리를 쓰고, 넘긴 색이 seed 보다 앞선다', async () => {
    await render(<DefaultAvatar size={84} seed="a" />);
    expect(StyleSheet.flatten(screen.getByTestId('default-avatar').props.style)).toMatchObject({ width: 84, height: 84, borderRadius: 32 });

    await render(<DefaultAvatar size={44} radius={22} seed="a" color={DEFAULT_AVATAR_GONE} />);
    expect(StyleSheet.flatten(screen.getByTestId('default-avatar').props.style)).toMatchObject({
      width: 44,
      borderRadius: 22,
      backgroundColor: '#C9CED6',
    });
  });
});
