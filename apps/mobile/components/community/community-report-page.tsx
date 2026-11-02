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
import { COMMUNITY_REPORT_REASONS, REPORT_DETAIL_MAX, charCount, type CommunityReportReason } from '@/lib/community';
import { translate as t } from '@/lib/i18n';

/**
 * 게시판 글·댓글 신고 — 챌린지 신고(components/challenge-report-sheet)와 같은 전체 화면 페이지다(아래 시트 금지).
 * 사유는 게시판 서버 계약(spam·abuse·sexual·privacy·other)이고, 기타를 고르면 설명(500자, 선택)을 받는다.
 * `busy` 동안은 「신고하는 중…」으로 막는다.
 */
export function CommunityReportPage({
  visible,
  target,
  busy,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  target: 'post' | 'comment';
  busy?: boolean;
  onClose: () => void;
  onSubmit: (reason: CommunityReportReason, detail: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState<CommunityReportReason | null>(null);
  const [detail, setDetail] = useState('');

  const close = () => {
    setReason(null);
    setDetail('');
    onClose();
  };

  const tooLong = charCount(detail.trim()) > REPORT_DETAIL_MAX;
  return (
    <Modal visible={visible} animationType="fade" onRequestClose={close}>
      <KeyboardLift style={[styles.page, { paddingTop: insets.top }]}>
        <NavHeader
          title={t('communityReport.pageTitle')}
          left={<NavIconButton icon="x" label={t('common.close')} phLabel="community_report_close" onPress={close} />}
        />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={styles.head}>
            <Text style={styles.title}>{target === 'post' ? t('communityReport.titlePost') : t('communityReport.titleComment')}</Text>
            <Text style={styles.subtitle}>{t('communityReport.subtitle')}</Text>
          </View>
          {COMMUNITY_REPORT_REASONS.map((value) => (
            <Pressable
              key={value}
              style={({ pressed }) => [styles.row, reason === value && styles.rowOn, pressed && styles.pressed]}
              onPress={() => setReason(value)}
              accessibilityRole="radio"
              accessibilityLabel={t(`communityReport.${value}`)}
              accessibilityState={{ selected: reason === value }}>
              <Checkbox checked={reason === value} />
              <Text style={[styles.rowText, reason === value && styles.rowTextOn]}>{t(`communityReport.${value}`)}</Text>
            </Pressable>
          ))}
          {reason === 'other' && (
            <View style={styles.noteBlock}>
              <TextField
                label={t('communityReport.detailLabel')}
                value={detail}
                onChangeText={setDetail}
                maxLength={REPORT_DETAIL_MAX}
                multiline
                textAlignVertical="top"
                style={styles.noteInput}
              />
              <Text style={[styles.noteCounter, tooLong && styles.noteOver]}>
                {t('communityReport.counter', { count: charCount(detail), max: REPORT_DETAIL_MAX })}
              </Text>
            </View>
          )}
        </ScrollView>
        <CtaBar>
          <Button
            variant="danger"
            label={t('communityReport.submit')}
            loading={busy}
            loadingLabel={t('communityReport.submitting')}
            disabled={!reason || tooLong}
            phLabel="community_report_submit"
            onPress={() => {
              if (!reason) return;
              onSubmit(reason, reason === 'other' ? detail.trim() : '');
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
