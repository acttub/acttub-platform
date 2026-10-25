import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';
import type { MarketingNotice } from '@/lib/marketing-consent';
import { subscribeMarketingNotice } from '@/lib/marketing-notice';

/** 처리 결과를 읽을 시간. 누르면 바로 닫는다. */
const NOTICE_VISIBLE_MS = 7000;

/**
 * S5.13 광고성 정보 수신 동의 결과 안내 — 다음 화면 아래쪽에 뜨는 어두운 토스트(제목 · 「이메일 · 앱 푸시 · Acttub · 처리일」 · 바꾸는 곳 안내).
 * 정보통신망법 제50조 제7항의 처리 결과(보낸 곳 · 처리일 · 매체별 결과)를 담는다. 화면을 막지 않고 일정 시간 뒤 사라지며, 누르면 닫힌다.
 *
 * 모양은 pen 「광고성 정보 동의 결과(S5.13)」 — 좌우 24, 모서리 12 어두운 카드(#2B2F36), 안쪽 [12,16], 제목 14/700 흰색, 둘째·셋째 줄 12/400 회색.
 */
export function MarketingNoticeDialog({ notice, onClose }: { notice: MarketingNotice | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(onClose, NOTICE_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [notice, onClose]);
  if (!notice) return null;
  // 모두 같은 결과면 매체 이름만, 섞였으면 매체마다 결과를 붙인다.
  const same = notice.rows.every((row) => row.granted === notice.rows[0]?.granted);
  const channels = notice.rows.map((row) => (same ? row.channel : `${row.channel} ${row.result}`)).join(' · ');
  const detail = [channels, notice.sender, notice.date].filter(Boolean).join(' · ');
  return (
    <View style={[styles.wrap, { bottom: 96 + insets.bottom }]} pointerEvents="box-none">
      <Pressable
        style={styles.toast}
        testID="marketing-notice-card"
        onPress={onClose}
        accessibilityRole="alert"
        accessibilityLabel={`${notice.title}. ${detail}. ${t('consent.marketingNoticeFoot')}`}>
        <Text style={styles.title}>{notice.title}</Text>
        <Text style={styles.line}>{detail}</Text>
        <Text style={styles.line}>{t('consent.marketingNoticeFoot')}</Text>
      </Pressable>
    </View>
  );
}

/** 앱 전체에 하나 두는 자리. 가입 동의·재동의가 보낸 결과를 다음 화면 위에 띄운다(lib/marketing-notice). */
export function MarketingNoticeHost() {
  const [notice, setNotice] = useState<MarketingNotice | null>(null);
  useEffect(() => subscribeMarketingNotice(setNotice), []);
  return <MarketingNoticeDialog notice={notice} onClose={() => setNotice(null)} />;
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 24, right: 24, zIndex: 50 },
  toast: { backgroundColor: '#2B2F36', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16, gap: 4, alignItems: 'center' },
  title: { fontSize: 14, fontWeight: '700', lineHeight: 20, color: '#FFFFFF', textAlign: 'center' },
  line: { fontSize: 12, fontWeight: '400', lineHeight: 18, color: '#B0B8C1', textAlign: 'center' },
});
