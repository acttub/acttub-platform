import Feather from '@expo/vector-icons/Feather';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';

type Arrow = {
  icon: 'chevron-right' | 'chevron-down';
  onPress: () => void;
  accessibilityLabel: string;
};

/**
 * 동의 항목 한 줄 — 체크 · 제목 · (문서가 있으면) 화살표. 가입 동의 화면과 재동의 팝업이 같이 쓴다.
 *
 * 필수·선택 모두 체크 한 줄이다. 선택 문서는 체크하면 동의, 비워 두면 거절이다(SOMA-544).
 * 거절 버튼을 두면 안 고르고 지나갈 수가 없어 '선택'이라는 말과 어긋났다.
 * children은 줄 아래에 펼쳐 보일 것(가입 화면의 문서 본문)이다.
 * 모양은 pen 「S4 동의」의 동의 줄(SOMA-748) — 체크 20 · 글 16/700 · 꺾쇠 18, 줄 사이 선 없음.
 */
export function ConsentRow({
  label,
  checked,
  locked,
  onToggle,
  arrow,
  children,
  divided,
}: {
  label: string;
  checked: boolean;
  locked: boolean;
  onToggle: () => void;
  arrow?: Arrow;
  children?: ReactNode;
  /** 줄 아래 선을 긋는 옛 모양(pen S/ConsentRow) — 재동의 팝업. */
  divided?: boolean;
}) {
  return (
    <View style={divided && styles.dividedWrap}>
      <Pressable
        style={[styles.row, divided && styles.dividedRow, locked && styles.locked]}
        onPress={onToggle}
        disabled={locked}
        accessibilityRole="checkbox"
        accessibilityState={{ checked, disabled: locked }}>
        <Feather name="check" size={20} color={checked ? palette.blue : palette.checkOff} />
        <Text style={[styles.label, divided && styles.dividedLabel, checked && styles.labelOn]} numberOfLines={1}>
          {label}
        </Text>
        {arrow && (
          <Pressable
            hitSlop={10}
            onPress={arrow.onPress}
            accessibilityRole="button"
            accessibilityLabel={arrow.accessibilityLabel}>
            <Feather name={arrow.icon} size={18} color={palette.checkOff} />
          </Pressable>
        )}
      </Pressable>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  dividedWrap: { borderBottomWidth: 1, borderBottomColor: palette.borderSoft },
  dividedRow: { paddingVertical: 16, paddingHorizontal: 0, gap: 12 },
  dividedLabel: { fontSize: 15, fontWeight: '600' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  locked: { opacity: 0.6 },
  label: { flex: 1, fontSize: 16, fontWeight: '700', color: palette.textDim },
  labelOn: { color: palette.text },
});
