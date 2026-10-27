import Feather from '@expo/vector-icons/Feather';

import { palette } from '@/constants/palette';

/**
 * 디자인 시스템 pen 「Checkbox/On·Off·Danger」 — 사각 상자 없이 원형 체크 아이콘 22 하나.
 * 켜짐 blue, 꺼짐 text-disabled. 되돌릴 수 없는 일에 동의하는 체크만 `danger`로 켜짐을 빨갛게 한다.
 * 누르는 자리·접근성 역할은 줄(Pressable)이 갖는다. 이것은 그림만 그린다.
 */
export function Checkbox({ checked, danger }: { checked: boolean; danger?: boolean }) {
  return (
    <Feather
      name={checked ? 'check-circle' : 'circle'}
      size={22}
      color={checked ? (danger ? palette.danger : palette.blue) : palette.textDisabled}
    />
  );
}
