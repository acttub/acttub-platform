import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { KeyboardLift } from '@/components/keyboard-lift';
import { Button } from '@/components/ui/buttons';
import { Checkbox } from '@/components/ui/checkbox';
import { CtaBar } from '@/components/ui/cta-bar';
import { NavHeader, NavIconButton } from '@/components/ui/nav-header';
import { TextField } from '@/components/ui/text-field';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import {
  REPORT_REASONS,
  canSendReport,
  needsNote,
  noteTooLong,
} from '@/lib/challenge/moderation';
import { REPORT_NOTE_MAX, type ReportReason, type ReportTarget } from '@/lib/challenge/types';
import { translate as t } from '@/lib/i18n';

/**
 * A15.4 신고(challenge.report) — 참여작·댓글·챌린지를 사유와 함께 신고한다. 아래에서 올라오는 시트 대신
 * 전체 화면 페이지다(SOMA-821, 하단 시트 금지): 머리줄 「신고」+닫기, 사유 목록, 아래 고정 「신고하기」.
 *
 * 사유 다섯 개를 각각 선택지로 두고, 기타를 고르면 메모(200자, 선택)를 받는다. 참여작·댓글은
 * 접수 즉시 숨겨지고 챌린지는 신고가 쌓이면 운영이 본다 — 안내 문구가 다르다.
 */
export function ChallengeReportSheet({
  visible,
  target,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  target: ReportTarget;
  onClose: () => void;
  onSubmit: (reason: ReportReason, note: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState('');

  const close = () => {
    setReason(null);
    setNote('');
    onClose();
  };

  const title =
    target === 'comment'
      ? t('videoReport.titleComment')
      : target === 'challenge'
        ? t('videoReport.titleChallenge')
        : t('videoReport.title');

  const ready = canSendReport({ reason, note });
  return (
    <Modal visible={visible} animationType="fade" onRequestClose={close}>
      {/* 키보드가 뜨면 아래 고정 버튼이 키보드 위로 올라오게 비운다. */}
      <KeyboardLift style={[styles.page, { paddingTop: insets.top }]}>
        <NavHeader
          title={t('videoReport.pageTitle')}
          left={<NavIconButton icon="x" label={t('videoReport.close')} phLabel="report_close" onPress={close} />}
        />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={styles.head}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>{t('videoReport.subtitle')}</Text>
          </View>

          {REPORT_REASONS.map((value) => (
            <Pressable
              key={value}
              style={({ pressed }) => [styles.row, reason === value && styles.rowOn, pressed && styles.pressed]}
              onPress={() => setReason(value)}
              accessibilityRole="radio"
              accessibilityLabel={t(`videoReport.${value}`)}
              accessibilityState={{ selected: reason === value }}>
              <Checkbox checked={reason === value} />
              <Text style={[styles.rowText, reason === value && styles.rowTextOn]}>{t(`videoReport.${value}`)}</Text>
            </Pressable>
          ))}

          {reason !== null && needsNote(reason) && (
            <View style={styles.noteBlock}>
              <TextField
                label={t('videoReport.noteLabel')}
                value={note}
                onChangeText={setNote}
                maxLength={REPORT_NOTE_MAX}
                multiline
                textAlignVertical="top"
                style={styles.noteInput}
              />
              <Text style={[styles.noteCounter, noteTooLong(note) && styles.noteOver]}>
                {t('videoReport.noteCounter', { count: [...note].length, max: REPORT_NOTE_MAX })}
              </Text>
            </View>
          )}
        </ScrollView>
        <CtaBar>
          <Button
            variant="danger"
            label={t('videoReport.submit')}
            disabled={!ready}
            phLabel="report_submit"
            onPress={() => {
              if (!reason) return;
              onSubmit(reason, note);
              setReason(null);
              setNote('');
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
  pressed: { opacity: 0.7 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: 52,
    paddingHorizontal: space[4],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.bg,
  },
  rowOn: { backgroundColor: palette.blueSoft, borderColor: palette.blue, borderWidth: 1.5, paddingHorizontal: space[4] - 0.5 },
  rowText: { ...type.body1, flex: 1, color: palette.text },
  rowTextOn: { ...type.body1Bold, color: palette.blueDeep },
  noteBlock: { gap: space[1.5], paddingTop: space[2] },
  noteInput: { minHeight: 96, paddingTop: space[3] },
  noteCounter: { ...type.caption, color: palette.textMeta, textAlign: 'right' },
  noteOver: { color: palette.danger },
});
