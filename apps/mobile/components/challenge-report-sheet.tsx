import Feather from '@expo/vector-icons/Feather';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import {
  REPORT_REASONS,
  canSendReport,
  needsNote,
  noteTooLong,
} from '@/lib/challenge/moderation';
import { REPORT_NOTE_MAX, type ReportReason, type ReportTarget } from '@/lib/challenge/types';
import { translate as t } from '@/lib/i18n';

/**
 * A15.4 신고(challenge.report) — 참여작·댓글·챌린지를 사유와 함께 신고한다.
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

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} accessibilityRole="button" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 8 }]}>
        <View style={styles.grabber} />
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{t('videoReport.subtitle')}</Text>

        {REPORT_REASONS.map((value) => (
          <Pressable
            key={value}
            style={({ pressed }) => [styles.row, reason === value && styles.rowOn, pressed && styles.pressed]}
            onPress={() => setReason(value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: reason === value }}>
            <Text style={[styles.rowText, reason === value && styles.rowTextOn]}>{t(`videoReport.${value}`)}</Text>
            {reason === value ? (
              <Feather name="check" size={16} color={palette.blue} />
            ) : (
              <Feather name="chevron-right" size={16} color={palette.checkOff} />
            )}
          </Pressable>
        ))}

        {reason !== null && needsNote(reason) && (
          <View style={styles.noteBlock}>
            <Text style={styles.noteLabel}>{t('videoReport.noteLabel')}</Text>
            <TextInput
              style={styles.noteInput}
              value={note}
              onChangeText={setNote}
              maxLength={REPORT_NOTE_MAX}
              multiline
              textAlignVertical="top"
            />
            <Text style={[styles.noteCounter, noteTooLong(note) && styles.noteOver]}>
              {t('videoReport.noteCounter', { count: [...note].length, max: REPORT_NOTE_MAX })}
            </Text>
          </View>
        )}

        <Pressable
          style={[styles.submit, !canSendReport({ reason, note }) && styles.submitOff]}
          disabled={!canSendReport({ reason, note })}
          onPress={() => {
            if (!reason) return;
            onSubmit(reason, note);
            setReason(null);
            setNote('');
          }}
          accessibilityRole="button">
          <Text style={styles.submitText}>{t('videoReport.submit')}</Text>
        </Pressable>
        <Pressable style={styles.cancel} onPress={close} accessibilityRole="button">
          <Text style={styles.cancelText}>{t('common.cancel')}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: palette.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 6,
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: palette.border, marginBottom: 10 },
  title: { fontSize: 16, fontWeight: '900', color: palette.text },
  subtitle: { fontSize: 12.5, color: palette.textFaint, marginBottom: 6 },
  pressed: { opacity: 0.7 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  rowOn: { backgroundColor: palette.blueSoft },
  rowText: { fontSize: 14.5, color: palette.text },
  rowTextOn: { fontWeight: '800', color: palette.blueDeep },
  noteBlock: { gap: 6, paddingTop: 6 },
  noteLabel: { fontSize: 12.5, fontWeight: '800', color: palette.textMuted },
  noteInput: {
    minHeight: 80,
    borderRadius: 12,
    backgroundColor: palette.bgSoft,
    padding: 12,
    fontSize: 14,
    color: palette.text,
  },
  noteCounter: { fontSize: 11.5, color: palette.textFaint, textAlign: 'right' },
  noteOver: { color: palette.danger },
  submit: { height: 50, borderRadius: 14, backgroundColor: palette.danger, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  submitOff: { backgroundColor: '#E2C8C8' },
  submitText: { fontSize: 15, fontWeight: '900', color: '#FFFFFF' },
  cancel: { paddingVertical: 14, alignItems: 'center' },
  cancelText: { fontSize: 14.5, fontWeight: '700', color: palette.textDim },
});
