import { useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { KeyboardLift } from '@/components/keyboard-lift';
import { Button } from '@/components/ui/buttons';
import { CtaBar } from '@/components/ui/cta-bar';
import { NavHeader, NavIconButton } from '@/components/ui/nav-header';
import { SelectCard } from '@/components/ui/select-card';
import { TextField } from '@/components/ui/text-field';
import { palette } from '@/constants/palette';
import { space, type } from '@/constants/tokens';

/**
 * 신고 페이지 틀 — 아래에서 올라오는 시트 대신 전체 화면 페이지다(SOMA-821, 하단 시트 금지): 머리줄 「신고」+닫기, 사유 목록,
 * 아래 고정 「신고하기」. 기타(`other`)를 고르면 메모를 받는다. 챌린지(challenge-report-sheet)와 게시판(community-report-page)이
 * 사유 목록·문구·메모 한도만 달리해 같이 쓴다. 메모 길이는 앞뒤 공백을 뺀 코드포인트 수로 센다.
 * 보내면 고른 사유와 메모를 비운다 — 닫았다 다시 열어도 지난 선택이 남지 않는다.
 */
export function ReportPage<Reason extends string>({
  visible,
  reasons,
  copy,
  noteMax,
  busy,
  phLabels,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  reasons: readonly Reason[];
  copy: {
    pageTitle: string;
    title: string;
    subtitle: string;
    close: string;
    reason: (reason: Reason) => string;
    noteLabel: string;
    counter: (count: number, max: number) => string;
    submit: string;
    submitting?: string;
  };
  noteMax: number;
  busy?: boolean;
  phLabels: { close: string; submit: string };
  onClose: () => void;
  onSubmit: (reason: Reason, note: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState<Reason | null>(null);
  const [note, setNote] = useState('');

  const reset = () => {
    setReason(null);
    setNote('');
  };
  const close = () => {
    reset();
    onClose();
  };

  const tooLong = [...note.trim()].length > noteMax;
  return (
    <Modal visible={visible} animationType="fade" onRequestClose={close}>
      {/* 키보드가 뜨면 아래 고정 버튼이 키보드 위로 올라오게 비운다. */}
      <KeyboardLift style={[styles.page, { paddingTop: insets.top }]}>
        <NavHeader title={copy.pageTitle} left={<NavIconButton icon="x" label={copy.close} phLabel={phLabels.close} onPress={close} />} />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={styles.head}>
            <Text style={styles.title}>{copy.title}</Text>
            <Text style={styles.subtitle}>{copy.subtitle}</Text>
          </View>
          {reasons.map((value) => (
            <SelectCard key={value} title={copy.reason(value)} selected={reason === value} onPress={() => setReason(value)} />
          ))}
          {reason === 'other' && (
            <View style={styles.noteBlock}>
              <TextField
                label={copy.noteLabel}
                value={note}
                onChangeText={setNote}
                maxLength={noteMax}
                multiline
                textAlignVertical="top"
                style={styles.noteInput}
              />
              <Text style={[styles.noteCounter, tooLong && styles.noteOver]}>{copy.counter([...note].length, noteMax)}</Text>
            </View>
          )}
        </ScrollView>
        <CtaBar>
          <Button
            variant="danger"
            label={copy.submit}
            loading={busy}
            loadingLabel={copy.submitting}
            disabled={!reason || tooLong}
            phLabel={phLabels.submit}
            onPress={() => {
              if (!reason) return;
              onSubmit(reason, reason === 'other' ? note : '');
              reset();
            }}
          />
        </CtaBar>
      </KeyboardLift>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: { backgroundColor: palette.bg },
  scroll: { flex: 1 },
  body: { paddingHorizontal: space.gutter, paddingTop: space[3], paddingBottom: space[3], gap: space[2] },
  head: { gap: space[1], marginBottom: space[2] },
  title: { ...type.title2, color: palette.text },
  subtitle: { ...type.caption, color: palette.textMeta },
  noteBlock: { gap: space[1.5], paddingTop: space[2] },
  noteInput: { minHeight: 96, paddingTop: space[3] },
  noteCounter: { ...type.caption, color: palette.textMeta, textAlign: 'right' },
  noteOver: { color: palette.danger },
});
