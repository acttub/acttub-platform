import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
import { KeyboardAwareScroll } from '@/components/keyboard-aware-scroll';
import { Markdown } from '@/components/markdown';
import { api, type ConsentEntryDocument } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { consentPreferencesForEntry } from '@/lib/consent-entry';
import { getConsentPrefs, setConsentPref } from '@/lib/consent-prefs';
import { disablePush, enablePush, isPushEnabled } from '@/lib/notifications';
import { getUserName, saveUserName } from '@/lib/profile';
import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';

/**
 * 설정 — 이미 가입된 유저도 이름 수정·선택 동의 관리·로그아웃을 할 수 있다.
 * 문서와 현재 결정은 서버의 동의 진입 판정을 정본으로 쓴다. 로컬 consent-prefs는
 * 새 인터페이스가 없는 구형 서버에서만 화면 복구용으로 사용한다.
 */
export default function SettingsScreen() {
  const router = useRouter();
  const { user, consentEntry, signOut, refreshConsentEntry } = useAuth();
  const [initialConsentEntry] = useState(() => consentEntry.entry);
  const [name, setName] = useState('');
  const [savedName, setSavedName] = useState('');
  const [docs, setDocs] = useState<ConsentEntryDocument[]>([]);
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nameSaved, setNameSaved] = useState(false);
  const [pushOn, setPushOn] = useState(true);
  const [updatingConsentId, setUpdatingConsentId] = useState<string | null>(null);
  const { confirm, alert, dialog } = useAppDialog();

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [n, cachedPrefs, push] = await Promise.all([
        getUserName(),
        getConsentPrefs(),
        isPushEnabled(),
      ]);
      let consentDocuments: ConsentEntryDocument[];
      let currentPrefs = cachedPrefs;
      if (initialConsentEntry && initialConsentEntry.documents.length > 0) {
        consentDocuments = initialConsentEntry.documents;
        currentPrefs = consentPreferencesForEntry(initialConsentEntry);
      } else {
        const legacy = await api.consentDocuments();
        consentDocuments = legacy.documents.map((document) => ({
          ...document,
          current_decision: cachedPrefs[document.id] ? 'granted' : null,
        }));
      }
      setName(n ?? '');
      setSavedName(n ?? '');
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

  const saveName = useCallback(async () => {
    await saveUserName(name);
    setSavedName(name.trim());
    setNameSaved(true);
    setTimeout(() => setNameSaved(false), 1500);
  }, [name]);

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
              ? {
                  ...document,
                  current_decision: next ? 'granted' : 'revoked',
                }
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

  const DocBody = ({ doc }: { doc: ConsentEntryDocument }) =>
    expanded[doc.id] ? (
      <View style={styles.docBody}>
        <Markdown source={doc.body} variant="compact" />
      </View>
    ) : null;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Text style={styles.screenTitle}>{t('settings.title')}</Text>
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
        <KeyboardAwareScroll contentContainerStyle={styles.list}>
          {/* 프로필 */}
          <Text style={styles.sectionTitle}>{t('settings.profile')}</Text>
          {!!user?.email && <Text style={styles.email}>{user.email}</Text>}
          <Text style={styles.label}>{t('settings.nameLabel')}</Text>
          <View style={styles.nameRow}>
            <TextInput
              style={styles.input}
              placeholder={t('settings.namePlaceholder')}
              placeholderTextColor={palette.textDim}
              value={name}
              onChangeText={setName}
              returnKeyType="done"
            />
            <Pressable
              style={[styles.saveBtn, name.trim() === savedName && styles.saveBtnOff]}
              onPress={saveName}
              disabled={name.trim() === savedName}>
              <Text style={styles.saveBtnText}>{nameSaved ? t('common.saved') : t('common.save')}</Text>
            </Pressable>
          </View>

          {/* 필수 동의 — 수락된 문서는 열람만, 거절·철회된 문서는 다시 수락할 수 있다. */}
          {required.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>{t('settings.requiredConsent')}</Text>
              {required.map((doc) => (
                <View key={doc.id} style={styles.docCard}>
                  <View style={styles.docRow}>
                    <Pressable
                      style={styles.docTitleWrap}
                      onPress={() => setExpanded((e) => ({ ...e, [doc.id]: !e[doc.id] }))}>
                      <Text style={styles.docTitle}>{doc.title}</Text>
                      <Text style={styles.viewLink}>
                        {expanded[doc.id] ? t('common.fold') : t('common.detail')}
                      </Text>
                    </Pressable>
                    {doc.current_decision === 'granted' ? (
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
                    )}
                  </View>
                  <DocBody doc={doc} />
                </View>
              ))}
            </>
          )}

          {/* 선택 동의 (토글) */}
          {optional.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>{t('settings.optionalConsent')}</Text>
              <Text style={styles.sectionHint}>{t('settings.optionalHint')}</Text>
              {optional.map((doc) => (
                <View key={doc.id} style={styles.docCard}>
                  <View style={styles.docRow}>
                    <Pressable
                      style={styles.docTitleWrap}
                      onPress={() => setExpanded((e) => ({ ...e, [doc.id]: !e[doc.id] }))}>
                      <Text style={styles.docTitle}>{doc.title}</Text>
                      <Text style={styles.viewLink}>{expanded[doc.id] ? t('common.fold') : t('common.detail')}</Text>
                    </Pressable>
                    <Switch
                      value={!!prefs[doc.id]}
                      onValueChange={(v) => toggle(doc, v)}
                      disabled={updatingConsentId === doc.id}
                      trackColor={{ true: palette.blue, false: palette.border }}
                      thumbColor="#FFFFFF"
                      ios_backgroundColor={palette.border}
                    />
                  </View>
                  <DocBody doc={doc} />
                </View>
              ))}
            </>
          )}

          {/* 알림 — 분석 완료 푸시와 연습 리마인드를 한 토글로 켠다/끈다. */}
          <Text style={styles.sectionTitle}>{t('settings.notifications')}</Text>
          <View style={styles.docCard}>
            <View style={styles.docRow}>
              <View style={styles.docTitleWrap}>
                <Text style={styles.docTitle}>{t('settings.notifTitle')}</Text>
              </View>
              <Switch
                value={pushOn}
                onValueChange={(v) => void togglePush(v)}
                trackColor={{ true: palette.blue, false: palette.border }}
                thumbColor="#FFFFFF"
                ios_backgroundColor={palette.border}
              />
            </View>
            <Text style={styles.sectionHint}>
              {t('settings.notifBody')}
            </Text>
          </View>

          {/* 코치가 나에 대해 적어 둔 것. 틀린 내용을 되돌릴 수 있는 유일한 자리라
              동의·탈퇴처럼 눈에 띄는 위치에 둔다. */}
          <Text style={styles.sectionTitle}>{t('settings.memorySection')}</Text>
          <Text style={styles.sectionHint}>
            {t('settings.memoryHint')}
          </Text>
          <Pressable
            style={styles.memoryRow}
            onPress={() => router.push('/memory')}
            accessibilityRole="button">
            <Text style={styles.memoryText}>{t('settings.memoryLink')}</Text>
            <Text style={styles.memoryChevron}>›</Text>
          </Pressable>

          {/* 개발 빌드에서만 보인다. 영상 업로드·분석을 지나지 않고 화면만 확인하는 통로. */}
          {__DEV__ && (
            <Pressable
              style={styles.previewRow}
              onPress={() => router.push('/ui-preview')}>
              <Text style={styles.previewText}>{t('settings.uiPreview')}</Text>
            </Pressable>
          )}

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
        </KeyboardAwareScroll>
      )}
      {dialog}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  memoryRow: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  memoryText: { fontSize: 15, color: palette.text },
  memoryChevron: { fontSize: 20, color: palette.checkOff },
  previewRow: {
    marginTop: 24,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  previewText: { fontSize: 13.5, fontWeight: '800', color: palette.textFaint },

  safe: { flex: 1, backgroundColor: palette.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadError: { color: palette.danger, fontSize: 14, textAlign: 'center', paddingHorizontal: 24 },
  reloadBtn: { marginTop: 12, paddingHorizontal: 16, paddingVertical: 10 },
  reloadText: { color: palette.blue, fontSize: 14, fontWeight: '700' },
  screenTitle: { fontSize: 22, fontWeight: '800', color: palette.text, paddingHorizontal: 20, paddingTop: 12 },
  list: { padding: 20, paddingBottom: 130, gap: 8 },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: palette.textDim, marginTop: 18 },
  sectionHint: { fontSize: 12, color: palette.textFaint, marginTop: -2 },
  email: { fontSize: 14, color: palette.textDim, marginTop: 2 },
  label: { fontSize: 13, fontWeight: '700', color: palette.text, marginTop: 8 },
  nameRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: {
    flex: 1,
    backgroundColor: palette.bgSoft,
    borderRadius: 12,
    padding: 14,
    color: palette.text,
    fontSize: 15,
  },
  saveBtn: {
    backgroundColor: palette.blue,
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 13,
  },
  saveBtnOff: { opacity: 0.4 },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  docCard: {
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 14,
    padding: 14,
  },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  docTitleWrap: { flex: 1 },
  docTitle: { fontSize: 14, color: palette.text, fontWeight: '600', flexShrink: 1 },
  viewLink: { fontSize: 12, color: palette.textDim, textDecorationLine: 'underline', marginTop: 3 },
  agreedTag: { fontSize: 12, fontWeight: '700', color: palette.green },
  reacceptBtn: {
    minWidth: 72,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: palette.blueSoft,
    paddingHorizontal: 12,
  },
  reacceptText: { fontSize: 13, fontWeight: '700', color: palette.blue },
  docBody: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: palette.border,
  },
  logout: {
    marginTop: 28,
    paddingVertical: 15,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: 'center',
  },
  logoutText: { color: palette.danger, fontSize: 15, fontWeight: '700' },
  deleteRow: { marginTop: 10, paddingVertical: 14, alignItems: 'center' },
  deleteText: { color: palette.textFaint, fontSize: 13.5, fontWeight: '700' },
});
