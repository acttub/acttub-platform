import { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';

import { DialogButtons, DialogCard } from '@/components/ui/dialog';
import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';
import type { MarketingNotice } from '@/lib/marketing-consent';
import { subscribeMarketingNotice } from '@/lib/marketing-notice';

/**
 * S5.13 광고성 정보 수신 동의 결과 팝업 — 제목, 회색 표(보낸 곳 · 처리일 · 매체별 결과), 바꾸는 곳 안내, 확인 하나.
 * 정보통신망법 제50조 제7항의 처리 결과 알림이라 바깥을 눌러 닫지 않는다(확인을 눌러야 닫힌다).
 */
export function MarketingNoticeDialog({ notice, onClose }: { notice: MarketingNotice | null; onClose: () => void }) {
  if (!notice) return null;
  const rows = [
    { label: t('consent.marketingNoticeSender'), value: notice.sender, granted: false },
    { label: t('consent.marketingNoticeDate'), value: notice.date, granted: false },
    ...notice.rows.map((row) => ({ label: row.channel, value: row.result, granted: row.granted })),
  ];
  return (
    <Modal transparent statusBarTranslucent visible animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <DialogCard title={notice.title}>
          <View style={styles.table}>
            {rows.map((row) => (
              <View key={row.label} style={styles.row}>
                <Text style={styles.label}>{row.label}</Text>
                <Text style={[styles.value, row.granted && styles.valueGranted]}>{row.value}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.foot}>{t('consent.marketingNoticeFoot')}</Text>
          <DialogButtons confirmLabel={t('common.confirm')} onConfirm={onClose} />
        </DialogCard>
      </View>
    </Modal>
  );
}

/** 앱 전체에 하나 두는 자리. 가입 동의·재동의가 보낸 결과를 다음 화면 위에 띄운다(lib/marketing-notice). */
export function MarketingNoticeHost() {
  const [notice, setNotice] = useState<MarketingNotice | null>(null);
  useEffect(() => subscribeMarketingNotice(setNotice), []);
  return <MarketingNoticeDialog notice={notice} onClose={() => setNotice(null)} />;
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: palette.scrim,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  table: {
    alignSelf: 'stretch',
    marginTop: 14,
    backgroundColor: palette.bgSoft,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 10,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 14, color: palette.textDim },
  value: { fontSize: 14, fontWeight: '700', color: palette.text },
  valueGranted: { color: palette.blue },
  foot: { marginTop: 12, fontSize: 13, lineHeight: 19, color: palette.textMuted, textAlign: 'center' },
});
