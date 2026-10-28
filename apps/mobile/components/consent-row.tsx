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
 * 모양은 pen 「약관 / 동의 행」(파이프라인 반영버전) — 높이 55, 안쪽 [0,14], 체크 18 · 10 띄워 글 16/700 #333D4B · 꺾쇠 18, 줄 사이 선 없음.
 * `compact`는 아래에 하위 항목을 다는 줄(광고성 정보) — 높이를 글 높이(20)로 줄인다. 높이는 최소값이라 긴 제목은
 * 두 줄까지 내려가며 줄이 늘어난다(10/22 피드백 — 「[선택] 광고성 정보 (이메일 · 앱 푸시)」가 한 줄 고정이라 잘렸다).
 */
export function ConsentRow({
  label,
  checked,
  locked,
  onToggle,
  arrow,
  children,
  divided,
  compact,
  tag,
}: {
  label: string;
  checked: boolean;
  locked: boolean;
  onToggle: () => void;
  arrow?: Arrow;
  children?: ReactNode;
  /** 줄 아래 선을 긋는 옛 모양(pen S/ConsentRow) — 재동의 팝업. */
  divided?: boolean;
  compact?: boolean;
  /** 가입 동의 화면 모양(pen S4.1) — 동그라미 체크 · 필수/선택 표 · 글 16/600. 접근성 이름은 「[필수] 제목」이다. */
  tag?: { text: string; required: boolean };
}) {
  return (
    <View style={divided && styles.dividedWrap}>
      <Pressable
        style={[styles.row, compact && styles.compact, divided && styles.dividedRow, locked && styles.locked]}
        onPress={onToggle}
        disabled={locked}
        accessibilityRole="checkbox"
        accessibilityLabel={tag ? `${tag.text} ${label}` : undefined}
        accessibilityState={{ checked, disabled: locked }}>
        {tag ? (
          // 가입 동의 화면의 체크는 꺼져 있어도 빈 원이 아니라 회색 체크 모양이다(SOMA-923).
          <Feather name="check-circle" size={22} color={checked ? palette.blue : palette.textDisabled} />
        ) : (
          <Feather name="check" size={18} color={checked ? palette.blue : palette.checkOff} />
        )}
        {tag && (
          <View style={[styles.tag, tag.required ? styles.tagRequired : styles.tagOptional]}>
            <Text style={[styles.tagText, tag.required ? styles.tagTextRequired : styles.tagTextOptional]}>{tag.text}</Text>
          </View>
        )}
        <Text style={[styles.label, divided && styles.dividedLabel, tag && styles.tagLabel]} numberOfLines={2}>
          {label}
        </Text>
        {arrow && (
          <Pressable
            hitSlop={10}
            onPress={arrow.onPress}
            accessibilityRole="button"
            accessibilityLabel={arrow.accessibilityLabel}
            ph-label="consent_row_open">
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
  dividedRow: { minHeight: undefined, paddingVertical: 16, paddingHorizontal: 0, gap: 12 },
  dividedLabel: { fontSize: 15, fontWeight: '600' },
  row: {
    minHeight: 55,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
  },
  compact: { minHeight: 20 },
  locked: { opacity: 0.6 },
  tag: { borderRadius: 6, paddingHorizontal: 7, height: 22, alignItems: 'center', justifyContent: 'center' },
  tagRequired: { backgroundColor: palette.blueSoft },
  tagOptional: { backgroundColor: palette.bgSoft },
  tagText: { fontSize: 12, fontWeight: '700' },
  tagTextRequired: { color: palette.blueDeep },
  tagTextOptional: { color: palette.textMuted },
  tagLabel: { fontSize: 16, fontWeight: '600' },
  label: { flex: 1, fontSize: 16, fontWeight: '700', color: palette.textStrong },
});
