import Feather from '@expo/vector-icons/Feather';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Checkbox } from '@/components/ui/checkbox';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';

type Arrow = {
  icon: 'chevron-right' | 'chevron-down';
  onPress: () => void;
  accessibilityLabel: string;
};

/**
 * 동의 항목 한 줄 — 체크 · (필수/선택 꼬리표) · 제목 · (문서가 있으면) 꺾쇠. 가입 동의 화면과 재동의 팝업이 같이 쓴다.
 *
 * 필수·선택 모두 체크 한 줄이다. 선택 문서는 체크하면 동의, 비워 두면 거절이다(SOMA-544).
 * 거절 버튼을 두면 안 고르고 지나갈 수가 없어 '선택'이라는 말과 어긋났다.
 * children은 줄 아래에 펼쳐 보일 것(가입 화면의 문서 본문)이다.
 * 모양은 화면 pen 「consent.*」 — 최소 높이 56, 체크 22 · 12 띄워 꼬리표 · 글 body1-bold · 꺾쇠 20. 체크와 글자는 위쪽을 맞추고
 * 긴 제목은 두 줄까지 내려간다. `dense`는 재동의 팝업 줄(pen 「root.reconsent-*」) — 최소 높이 52, 글 body2-bold, 꺾쇠 18.
 */
export function ConsentRow({
  label,
  checked,
  locked,
  onToggle,
  arrow,
  children,
  dense,
  tag,
}: {
  label: string;
  checked: boolean;
  locked: boolean;
  onToggle: () => void;
  arrow?: Arrow;
  children?: ReactNode;
  dense?: boolean;
  /** 필수/선택 꼬리표. 접근성 이름은 「필수 제목」이다. */
  tag?: { text: string; required: boolean };
}) {
  return (
    <View>
      <Pressable
        style={[styles.row, dense && styles.dense, locked && styles.locked]}
        onPress={onToggle}
        disabled={locked}
        accessibilityRole="checkbox"
        accessibilityLabel={tag ? `${tag.text} ${label}` : undefined}
        accessibilityState={{ checked, disabled: locked }}>
        <Checkbox checked={checked} />
        {tag && (
          <View style={[styles.tag, tag.required ? styles.tagRequired : styles.tagOptional]}>
            <Text style={[styles.tagText, tag.required ? styles.tagTextRequired : styles.tagTextOptional]}>{tag.text}</Text>
          </View>
        )}
        <Text style={[styles.label, dense && styles.denseLabel]} numberOfLines={2}>
          {label}
        </Text>
        {arrow && (
          <Pressable
            hitSlop={10}
            onPress={arrow.onPress}
            accessibilityRole="button"
            accessibilityLabel={arrow.accessibilityLabel}
            ph-label="consent_row_open">
            <Feather name={arrow.icon} size={dense ? 18 : 20} color={palette.iconFaint} />
          </Pressable>
        )}
      </Pressable>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  // 한 줄일 때 56 가운데에 오도록 위아래 16, 두 줄이면 줄이 늘어난다.
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'flex-start', gap: space[3], paddingVertical: space[4] },
  dense: { minHeight: 52, paddingVertical: 15 },
  locked: { opacity: 0.6 },
  tag: { height: 20, marginTop: 2, paddingHorizontal: space[1.5], borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  tagRequired: { backgroundColor: palette.blueSoft },
  tagOptional: { backgroundColor: palette.bgSoft },
  tagText: type.micro,
  tagTextRequired: { color: palette.blueDeep },
  tagTextOptional: { color: palette.textMeta },
  label: { flex: 1, ...type.body1Bold, color: palette.text },
  denseLabel: type.body2Bold,
});
