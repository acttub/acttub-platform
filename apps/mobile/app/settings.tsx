import Feather from '@expo/vector-icons/Feather';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
import { Markdown } from '@/components/markdown';
import { palette } from '@/constants/palette';
import { api, type ConsentEntryDocument } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { consentPreferencesForEntry } from '@/lib/consent-entry';
import { getConsentPrefs, setConsentPref } from '@/lib/consent-prefs';
import { translate as t } from '@/lib/i18n';
import { disablePush, enablePush, isPushEnabled } from '@/lib/notifications';

/** 동의 문서 카드의 아이콘 — 제목으로 고른다(서버 문서엔 아이콘 필드가 없다). */
function docIcon(title: string): ReactNode {
  if (/개인정보|privacy/i.test(title)) return <Feather name="shield" size={18} color={palette.blue} />;
  if (/ai|분석|analysis/i.test(title)) return <Ionicons name="sparkles-outline" size={18} color={palette.blue} />;
  return <Feather name="file-text" size={18} color={palette.blue} />;
}

/**
 * A4 설정 — pen대로 "‹ 설정" 헤더 아래 필수 동의 카드(아이콘·제목·자세히 보기·동의됨),
 * 알림 카드(토글), 맨 아래 로그아웃·회원 탈퇴.
 *
 * 이름·프로필 편집은 프로필 탭(A4 프로필 → 편집)으로 옮겨져 여기선 뺐다. 코치의 기억과
 * 문의·신고는 pen엔 없지만 각각 기억 수정 창구·앱스토어 신고 창구(SOMA-499)라 같은
 * 카드 모양으로 남긴다. 문서와 현재 결정은 서버의 동의 진입 판정을 정본으로 쓴다.
 */
export default function SettingsScreen() {
  const router = useRouter();
  const { consentEntry, signOut, refreshConsentEntry } = useAuth();
  const [initialConsentEntry] = useState(() => consentEntry.entry);
  const [docs, setDocs] = useState<ConsentEntryDocument[]>([]);
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pushOn, setPushOn] = useState(true);
  const [updatingConsentId, setUpdatingConsentId] = useState<string | null>(null);
  const { confirm, alert, dialog } = useAppDialog();

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [cachedPrefs, push] = await Promise.all([getConsentPrefs(), isPushEnabled()]);
      let consentDocuments: ConsentEntryDocument[];
      let currentPrefs = cachedPrefs;
      if (initialConsentEntry && initialConsentEntry.documents.length > 0) {
        consentDocuments = initialConsentEntry.documents;
        currentPrefs = consentPreferencesForEntry(initialConsentEntry);
      } else {
        // 새 인터페이스가 없는 구형 서버 — 로컬 consent-prefs로 화면만 복구한다.
        const legacy = await api.consentDocuments();
        consentDocuments = legacy.documents.map((document) => ({
          ...document,
          current_decision: cachedPrefs[document.id] ? 'granted' : null,
        }));
      }
      setDocs(consentDocuments);
      setPrefs(currentPrefs);
      setPushOn(push);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t('consent.docFail'));
    } finally {
      setLoading(false);
    }
  }, [initialConsentEntry]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const togglePush = useCallback(async (next: boolean) => {
    // 낙관적으로 먼저 그린다 — 서버 해제/등록은 뒤에서 최선 노력으로 따라온다.
    setPushOn(next);
    if (next) await enablePush();
    else await disablePush();
  }, []);

  const toggle = useCallback(
    async (doc: ConsentEntryDocument, next: boolean) => {
      if (updatingConsentId === doc.id) return;
      const prev = prefs[doc.id];
      setUpdatingConsentId(doc.id);
      setPrefs((p) => ({ ...p, [doc.id]: next })); // 낙관적 업데이트
      try {
        await api.recordConsent(doc.id, next ? 'granted' : 'revoked');
        await setConsentPref(doc.id, next).catch(() => undefined);
        setDocs((current) =>
          current.map((document) =>
            document.id === doc.id
              ? { ...document, current_decision: next ? 'granted' : 'revoked' }
              : document,
          ),
        );
        if (doc.required) {
          await refreshConsentEntry().catch(() => undefined);
        }
      } catch (err) {
        setPrefs((p) => ({ ...p, [doc.id]: prev })); // 실패 시 롤백
        void alert({
          title: t('settings.changeFailTitle'),
          message: err instanceof Error ? err.message : t('common.tryLater'),
        });
      } finally {
        setUpdatingConsentId((current) => (current === doc.id ? null : current));
      }
    },
    [prefs, updatingConsentId, refreshConsentEntry, alert],
  );

  const required = docs.filter((d) => d.required);
  const optional = docs.filter((d) => !d.required);

  const confirmLogout = async () => {
    const ok = await confirm({
      title: t('settings.logoutTitle'),
      confirmLabel: t('settings.logout'),
      destructive: true,
    });
    if (ok) void signOut();
  };

  const openContactMail = async () => {
    const url = 'mailto:acttub0527@gmail.com?subject=' + encodeURIComponent('[Acttub] 문의·신고');
    try {
      const okToOpen = await Linking.canOpenURL(url);
      if (okToOpen) await Linking.openURL(url);
      else throw new Error('cannot open');
    } catch {
      void alert({ title: t('settings.contactMailFail'), message: 'acttub0527@gmail.com' });
    }
  };

  const toggleExpanded = (id: string) => setExpanded((e) => ({ ...e, [id]: !e[id] }));

  const renderDocCard = (doc: ConsentEntryDocument, right: ReactNode) => (
    <View key={doc.id} style={styles.card}>
      <Pressable style={styles.cardRow} onPress={() => toggleExpanded(doc.id)} accessibilityRole="button">
        <View style={styles.iconCircle}>{docIcon(doc.title)}</View>
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle}>{doc.title}</Text>
          <Text style={styles.cardSub}>{expanded[doc.id] ? t('common.fold') : t('common.detail')}</Text>
        </View>
        {right}
      </Pressable>
      {expanded[doc.id] && (
        <View style={styles.docBody}>
          <Markdown source={doc.body} variant="compact" />
        </View>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('common.back')}>
          <Feather name="chevron-left" size={26} color={palette.text} />
        </Pressable>
        <Text style={styles.title}>{t('settings.title')}</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={palette.blue} />
        </View>
      ) : loadError ? (
        <View style={styles.center}>
          <Text style={styles.loadError}>{loadError}</Text>
          <Pressable style={styles.reloadBtn} onPress={() => void loadSettings()}>
            <Text style={styles.reloadText}>{t('consent.reload')}</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {/* 필수 동의 — 수락된 문서는 열람만, 거절·철회된 문서는 다시 수락할 수 있다. */}
          {required.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>{t('settings.requiredConsent')}</Text>
              {required.map((doc) =>
                renderDocCard(
                  doc,
                  doc.current_decision === 'granted' ? (
                    <Text style={styles.agreedTag}>{t('settings.agreedTag')}</Text>
                  ) : (
                    <Pressable
                      style={styles.reacceptBtn}
                      onPress={() => void toggle(doc, true)}
                      disabled={updatingConsentId === doc.id}>
                      {updatingConsentId === doc.id ? (
                        <ActivityIndicator size="small" color={palette.blue} />
                      ) : (
                        <Text style={styles.reacceptText}>{t('settings.reaccept')}</Text>
                      )}
                    </Pressable>
                  ),
                ),
              )}
            </>
          )}

          {/* 선택 동의 (토글) */}
          {optional.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>{t('settings.optionalConsent')}</Text>
              {optional.map((doc) =>
                renderDocCard(
                  doc,
                  <Switch
                    value={!!prefs[doc.id]}
                    onValueChange={(v) => toggle(doc, v)}
                    disabled={updatingConsentId === doc.id}
                    trackColor={{ true: palette.blue, false: palette.border }}
                    thumbColor="#FFFFFF"
                    ios_backgroundColor={palette.border}
                  />,
                ),
              )}
            </>
          )}

          {/* 알림 — 분석 완료 푸시와 연습 리마인드를 한 토글로 켠다/끈다. */}
          <Text style={styles.sectionTitle}>{t('settings.notifications')}</Text>
          <View style={styles.card}>
            <View style={styles.cardRow}>
              <View style={styles.iconCircle}>
                <Feather name="bell" size={18} color={palette.blue} />
              </View>
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle}>{t('settings.notifTitle')}</Text>
                <Text style={styles.cardSub}>{t('settings.notifBody')}</Text>
              </View>
              <Switch
                value={pushOn}
                onValueChange={(v) => void togglePush(v)}
                trackColor={{ true: palette.blue, false: palette.border }}
                thumbColor="#FFFFFF"
                ios_backgroundColor={palette.border}
              />
            </View>
          </View>

          {/* 코치의 기억 — 틀린 내용을 되돌릴 수 있는 유일한 자리. */}
          <Text style={styles.sectionTitle}>{t('settings.memorySection')}</Text>
          <Pressable style={styles.card} onPress={() => router.push('/memory')} accessibilityRole="button">
            <View style={styles.cardRow}>
              <View style={styles.iconCircle}>
                <Feather name="book" size={18} color={palette.blue} />
              </View>
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle}>{t('settings.memoryLink')}</Text>
                <Text style={styles.cardSub}>{t('settings.memoryHint')}</Text>
              </View>
              <Feather name="chevron-right" size={18} color={palette.checkOff} />
            </View>
          </Pressable>

          {/* 문의·신고 (SOMA-499, App Store 1.2 — 앱 안에서 부적절 활동을 신고할 창구) */}
          <Text style={styles.sectionTitle}>{t('settings.contactSection')}</Text>
          <Pressable style={styles.card} onPress={() => void openContactMail()} accessibilityRole="button">
            <View style={styles.cardRow}>
              <View style={styles.iconCircle}>
                <Feather name="mail" size={18} color={palette.blue} />
              </View>
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle}>{t('settings.contactAction')}</Text>
                <Text style={styles.cardSub}>{t('settings.contactHint')}</Text>
              </View>
              <Feather name="chevron-right" size={18} color={palette.checkOff} />
            </View>
          </Pressable>

          {/* 개발 빌드에서만 보인다. 영상 업로드·분석을 지나지 않고 화면만 확인하는 통로. */}
          {__DEV__ && (
            <Pressable style={styles.previewRow} onPress={() => router.push('/ui-preview')}>
              <Text style={styles.previewText}>{t('settings.uiPreview')}</Text>
            </Pressable>
          )}

          <View style={styles.spacer} />

          <Pressable style={styles.logout} onPress={() => void confirmLogout()}>
            <Text style={styles.logoutText}>{t('settings.logout')}</Text>
          </Pressable>

          {/* 깊이 숨기지 않는다 — 앱스토어 심사가 계정 삭제를 앱 안에서 찾을 수 있는지 본다. */}
          <Pressable
            style={styles.deleteRow}
            onPress={() => router.push('/delete-account')}
            accessibilityRole="button">
            <Text style={styles.deleteText}>{t('settings.withdraw')}</Text>
          </Pressable>
        </ScrollView>
      )}
      {dialog}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bgSubtle },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 6,
  },
  title: { fontSize: 22, fontWeight: '800', color: palette.text },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadError: { color: palette.danger, fontSize: 14, textAlign: 'center', paddingHorizontal: 24 },
  reloadBtn: { marginTop: 12, paddingHorizontal: 16, paddingVertical: 10 },
  reloadText: { color: palette.blue, fontSize: 14, fontWeight: '700' },
  list: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24, gap: 10 },
  sectionTitle: { fontSize: 13.5, fontWeight: '800', color: palette.text, marginTop: 12 },
  card: {
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    borderRadius: 18,
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: palette.blueSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { flex: 1, gap: 4 },
  cardTitle: { fontSize: 15.5, fontWeight: '800', color: palette.text },
  cardSub: { fontSize: 12.5, color: palette.textFaint, lineHeight: 17 },
  agreedTag: { fontSize: 13.5, fontWeight: '800', color: palette.green },
  reacceptBtn: {
    minWidth: 72,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: palette.blueSoft,
    paddingHorizontal: 12,
  },
  reacceptText: { fontSize: 13, fontWeight: '700', color: palette.blue },
  docBody: { marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: palette.borderSoft },
  previewRow: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  previewText: { fontSize: 13.5, fontWeight: '800', color: palette.textFaint },
  spacer: { flex: 1, minHeight: 24 },
  logout: {
    paddingVertical: 17,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.card,
    alignItems: 'center',
  },
  logoutText: { color: palette.danger, fontSize: 16, fontWeight: '800' },
  deleteRow: { marginTop: 6, paddingVertical: 14, alignItems: 'center' },
  deleteText: { color: palette.textFaint, fontSize: 14, fontWeight: '600' },
});
