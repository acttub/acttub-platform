import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';
import type { MarketingNotice } from '@/lib/marketing-consent';
import { subscribeMarketingNotice } from '@/lib/marketing-notice';

/**
 * S5.13 광고성 정보 수신 동의 결과 팝업 — 제목, 회색 표(보낸 곳 · 처리일 · 매체별 결과), 바꾸는 곳 안내, 확인 하나.
 * 정보통신망법 제50조 제7항의 처리 결과 알림이라 바깥을 눌러 닫지 않는다(확인을 눌러야 닫힌다).
 *
 * 모양은 pen 01 「광고성 정보 동의 결과 팝업(S5.13)」 — 폭 292 흰 카드(모서리 20, 안쪽 [20,19,16,19], 줄 사이 10, 가운데 정렬),
 * 제목 18/700, 표는 #F2F4F6 모서리 14 안쪽 [6,15]에 줄마다 높이 28.5(라벨 14/400 #6B7684 · 값 14/700, 동의는 #4880EE),
 * 안내 14/400 #6B7684, 확인은 꽉 찬 높이 46 · 모서리 14 파란 버튼(17/700).
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
        <View style={styles.card} testID="marketing-notice-card">
          <Text style={styles.title}>{notice.title}</Text>
          <View style={styles.table}>
            {rows.map((row) => (
              <View key={row.label} style={styles.row}>
                <Text style={styles.label}>{row.label}</Text>
                <Text style={[styles.value, row.granted && styles.valueGranted]}>{row.value}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.foot}>{t('consent.marketingNoticeFoot')}</Text>
          <Pressable
            style={({ pressed }) => [styles.button, pressed && styles.pressed]}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t('common.confirm')}>
            <Text style={styles.buttonText}>{t('common.confirm')}</Text>
          </Pressable>
        </View>
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
    padding: 20,
  },
  card: {
    width: 292,
    maxWidth: '100%',
    alignItems: 'center',
    gap: 10,
    backgroundColor: palette.card,
    borderRadius: 20,
    paddingTop: 20,
    paddingHorizontal: 19,
    paddingBottom: 16,
  },
  title: { fontSize: 18, fontWeight: '700', color: palette.text, textAlign: 'center' },
  table: {
    alignSelf: 'stretch',
    backgroundColor: palette.bgSoft,
    borderRadius: 14,
    paddingVertical: 6,
    paddingHorizontal: 15,
  },
  row: { height: 28.5, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 14, fontWeight: '400', color: palette.textMuted },
  value: { fontSize: 14, fontWeight: '700', color: palette.text },
  valueGranted: { color: palette.blue },
  foot: { fontSize: 14, fontWeight: '400', lineHeight: 20, color: palette.textMuted, textAlign: 'center' },
  button: {
    alignSelf: 'stretch',
    height: 46,
    borderRadius: 14,
    backgroundColor: palette.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.85 },
  buttonText: { fontSize: 17, fontWeight: '700', color: palette.onAccent },
});
