import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NavBackButton, NavHeader } from '@/components/app-header';
import { useAppDialog } from '@/components/app-dialog';
import { MarketingNoticeDialog } from '@/components/marketing-notice-dialog';
import { Markdown } from '@/components/markdown';
import { BlueSwitch, TwoLineRow } from '@/components/ui/list-rows';
import { palette } from '@/constants/palette';
import { api } from '@/lib/api';
import { consentChangeFailureAction, consentSettingsRows, type ConsentSettingsRow } from '@/lib/consent-entry';
import { translate as t } from '@/lib/i18n';
import { isMarketingConsent, marketingDecisionNotice, type MarketingNotice } from '@/lib/marketing-consent';
import { SkeletonRows } from '@/components/ui/skeleton';

/** 「동의함 · 2026.09.03」 / 「거절함」 / 「아직 결정하지 않음」. */
function decisionLine(row: ConsentSettingsRow): string {
  if (row.decision === null) return t('settings.docUndecided');
  const word = t(row.decision === 'granted' ? 'settings.decisionGranted' : 'settings.decisionDeclined');
  return row.decidedDate ? `${word} · ${row.decidedDate}` : word;
}

/**
 * 동의 내역(pen OJWak, SOMA-748) — 예전 설정 화면의 동의 목록을 따로 뺐다. 문서를 누르면 그 자리에서 본문이 펼쳐진다.
 * 필수 문서는 내용만 보고(거두는 길은 탈퇴뿐), 선택 문서는 펼친 자리의 스위치로 동의와 거절을 오가며 바꾸는 즉시 저장한다.
 * 문서와 현재 결정은 서버의 동의 현황(GET /v2/consents/entry)이 정본이다 — 기기에 따로 적어 두지 않는다.
 */
export default function ConsentHistoryScreen() {
  const router = useRouter();
  const { alert, dialog } = useAppDialog();
  const [notice, setNotice] = useState<MarketingNotice | null>(null);
  const [rows, setRows] = useState<ConsentSettingsRow[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const loadConsents = useCallback(async () => {
    setRows(consentSettingsRows(await api.consentEntry()));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      await loadConsents();
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t('consent.docFail'));
    } finally {
      setLoading(false);
    }
  }, [loadConsents]);

  useEffect(() => {
    void load();
  }, [load]);

  // 선택 문서는 동의와 거절을 오간다. 바꾸는 즉시 저장하고, 되돌리려면 다시 바꾼다.
  const toggleConsent = useCallback(
    async (row: ConsentSettingsRow, granted: boolean) => {
      if (updatingId || !row.canChange) return;
      const decision = granted ? 'granted' : 'declined';
      setUpdatingId(row.id);
      setRows((current) => current.map((item) => (item.id === row.id ? { ...item, decision } : item))); // 낙관적 업데이트
      try {
        await api.recordConsent(row.id, decision);
        // 결정 시각은 서버가 정한다. 다시 받아 그린다.
        await loadConsents().catch(() => undefined);
        // 광고성 정보 수신 동의·거부는 처리 결과를 알린다(정보통신망법 제50조 제7항).
        if (isMarketingConsent(row.type)) {
          setNotice(marketingDecisionNotice([{ type: row.type, decision }], new Date()));
        }
      } catch (err) {
        if (consentChangeFailureAction(err) === 'reload') {
          // 보는 사이 새 판이 나왔다. 목록을 다시 받아 현재 판을 보여 준다.
          await loadConsents().catch(() => undefined);
          void alert({ title: t('settings.changeFailTitle'), message: t('consent.outdated') });
        } else {
          setRows((current) => current.map((item) => (item.id === row.id ? { ...item, decision: row.decision } : item))); // 실패 시 롤백
          void alert({
            title: t('settings.changeFailTitle'),
            message: err instanceof Error ? err.message : t('common.tryLater'),
          });
        }
      } finally {
        setUpdatingId(null);
      }
    },
    [updatingId, loadConsents, alert],
  );

  // 필수를 먼저, 선택을 뒤에.
  const ordered = [...rows.filter((row) => row.required), ...rows.filter((row) => !row.required)];

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <NavHeader title={t('settings.consentHistory')} left={<NavBackButton onPress={() => router.back()} />} />
      {loading ? (
        <SkeletonRows count={6} avatar={false} card={false} />
      ) : loadError ? (
        <View style={styles.center}>
          <Text style={styles.loadError}>{loadError}</Text>
          <Pressable style={styles.reloadBtn} onPress={() => void load()} accessibilityRole="button">
            <Text style={styles.reloadText}>{t('consent.reload')}</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {ordered.map((row) => {
            const open = !!expanded[row.id];
            const title = row.required ? row.title : `${row.title}${t('settings.optionalSuffix')}`;
            return (
              <View key={row.id}>
                <TwoLineRow
                  title={title}
                  sub={decisionLine(row)}
                  onPress={() => setExpanded((e) => ({ ...e, [row.id]: !e[row.id] }))}
                />
                {open && (
                  <View style={styles.docBody}>
                    <Text style={styles.docMeta}>
                      {[
                        t('settings.docVersion', { version: row.version }),
                        row.effectiveDate ? t('settings.docEffective', { date: row.effectiveDate }) : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                    {row.canChange && (
                      <View style={styles.switchRow}>
                        <Text style={styles.switchLabel}>{t('settings.decisionGranted')}</Text>
                        <BlueSwitch
                          value={row.decision === 'granted'}
                          onValueChange={(v) => void toggleConsent(row, v)}
                          disabled={updatingId !== null}
                          accessibilityLabel={title}
                        />
                      </View>
                    )}
                    <Markdown source={row.body} />
                  </View>
                )}
              </View>
            );
          })}
          <Text style={styles.note}>{t('settings.consentHistoryNote')}</Text>
        </ScrollView>
      )}
      {dialog}
      <MarketingNoticeDialog notice={notice} onClose={() => setNotice(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  list: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadError: { color: palette.danger, fontSize: 14, textAlign: 'center', paddingHorizontal: 24 },
  reloadBtn: { marginTop: 12, paddingHorizontal: 16, paddingVertical: 10 },
  reloadText: { color: palette.blue, fontSize: 14, fontWeight: '700' },
  docBody: { paddingBottom: 12, gap: 10 },
  docMeta: { fontSize: 13, fontWeight: '500', color: palette.textMeta },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  switchLabel: { fontSize: 15, fontWeight: '700', color: palette.text },
  note: { marginTop: 8, fontSize: 13, fontWeight: '600', lineHeight: 18, color: palette.textMeta },
});
