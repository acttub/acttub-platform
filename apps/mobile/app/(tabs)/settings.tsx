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
import { api, type ConsentDocument } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { getConsentPrefs, setConsentPref } from '@/lib/consent-prefs';
import { getUserName, saveUserName } from '@/lib/profile';
import { palette } from '@/constants/palette';

/**
 * 설정 — 이미 가입된 유저도 이름 수정·선택 동의 관리·로그아웃을 할 수 있다.
 * 서버가 "내 동의 상태"를 주는 GET이 없어, 선택 동의 토글 상태는 로컬(consent-prefs)로 반영한다.
 * 문서 목록은 GET /v2/consents/documents, 변경은 POST /v2/consents(granted/revoked).
 */
export default function SettingsScreen() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [name, setName] = useState('');
  const [savedName, setSavedName] = useState('');
  const [docs, setDocs] = useState<ConsentDocument[]>([]);
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [nameSaved, setNameSaved] = useState(false);
  const { confirm, alert, dialog } = useAppDialog();

  useEffect(() => {
    (async () => {
      const [n, list, p] = await Promise.all([
        getUserName(),
        api.consentDocuments().catch(() => ({ documents: [] as ConsentDocument[] })),
        getConsentPrefs(),
      ]);
      setName(n ?? '');
      setSavedName(n ?? '');
      setDocs(list.documents);
      setPrefs(p);
      setLoading(false);
    })();
  }, []);

  const saveName = useCallback(async () => {
    await saveUserName(name);
    setSavedName(name.trim());
    setNameSaved(true);
    setTimeout(() => setNameSaved(false), 1500);
  }, [name]);

  const toggle = useCallback(
    async (doc: ConsentDocument, next: boolean) => {
      const prev = prefs[doc.id];
      setPrefs((p) => ({ ...p, [doc.id]: next })); // 낙관적 업데이트
      try {
        await api.recordConsent(doc.id, next ? 'granted' : 'revoked');
        await setConsentPref(doc.id, next);
      } catch (err) {
        setPrefs((p) => ({ ...p, [doc.id]: prev })); // 실패 시 롤백
        void alert({
          title: '변경 실패',
          message: err instanceof Error ? err.message : '잠시 후 다시 시도해주세요.',
        });
      }
    },
    [prefs, alert],
  );

  const required = docs.filter((d) => d.required);
  const optional = docs.filter((d) => !d.required);

  const confirmLogout = async () => {
    const ok = await confirm({
      title: '로그아웃할까요?',
      confirmLabel: '로그아웃',
      destructive: true,
    });
    if (ok) void signOut();
  };

  const DocBody = ({ doc }: { doc: ConsentDocument }) =>
    expanded[doc.id] ? (
      <View style={styles.docBody}>
        <Markdown source={doc.body} variant="compact" />
      </View>
    ) : null;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Text style={styles.screenTitle}>설정</Text>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={palette.blue} />
        </View>
      ) : (
        <KeyboardAwareScroll contentContainerStyle={styles.list}>
          {/* 프로필 */}
          <Text style={styles.sectionTitle}>프로필</Text>
          {!!user?.email && <Text style={styles.email}>{user.email}</Text>}
          <Text style={styles.label}>이름</Text>
          <View style={styles.nameRow}>
            <TextInput
              style={styles.input}
              placeholder="실명 또는 활동명"
              placeholderTextColor={palette.textDim}
              value={name}
              onChangeText={setName}
              returnKeyType="done"
            />
            <Pressable
              style={[styles.saveBtn, name.trim() === savedName && styles.saveBtnOff]}
              onPress={saveName}
              disabled={name.trim() === savedName}>
              <Text style={styles.saveBtnText}>{nameSaved ? '저장됨' : '저장'}</Text>
            </Pressable>
          </View>

          {/* 필수 동의 (열람만) */}
          {required.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>필수 동의</Text>
              {required.map((doc) => (
                <View key={doc.id} style={styles.docCard}>
                  <Pressable
                    style={styles.docRow}
                    onPress={() => setExpanded((e) => ({ ...e, [doc.id]: !e[doc.id] }))}>
                    <Text style={styles.docTitle}>{doc.title}</Text>
                    <Text style={styles.agreedTag}>동의됨</Text>
                  </Pressable>
                  <DocBody doc={doc} />
                </View>
              ))}
            </>
          )}

          {/* 선택 동의 (토글) */}
          {optional.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>선택 동의</Text>
              <Text style={styles.sectionHint}>언제든 켜고 끌 수 있어요.</Text>
              {optional.map((doc) => (
                <View key={doc.id} style={styles.docCard}>
                  <View style={styles.docRow}>
                    <Pressable
                      style={styles.docTitleWrap}
                      onPress={() => setExpanded((e) => ({ ...e, [doc.id]: !e[doc.id] }))}>
                      <Text style={styles.docTitle}>{doc.title}</Text>
                      <Text style={styles.viewLink}>{expanded[doc.id] ? '접기' : '자세히'}</Text>
                    </Pressable>
                    <Switch
                      value={!!prefs[doc.id]}
                      onValueChange={(v) => toggle(doc, v)}
                      trackColor={{ true: palette.blue, false: palette.border }}
                    />
                  </View>
                  <DocBody doc={doc} />
                </View>
              ))}
            </>
          )}

          {/* 코치가 나에 대해 적어 둔 것. 틀린 내용을 되돌릴 수 있는 유일한 자리라
              동의·탈퇴처럼 눈에 띄는 위치에 둔다. */}
          <Text style={styles.sectionTitle}>코치의 기억</Text>
          <Text style={styles.sectionHint}>
            코치가 나에 대해 무엇을 기억하는지 보고 고칠 수 있어요.
          </Text>
          <Pressable
            style={styles.memoryRow}
            onPress={() => router.push('/memory')}
            accessibilityRole="button">
            <Text style={styles.memoryText}>코치가 기억하는 것</Text>
            <Text style={styles.memoryChevron}>›</Text>
          </Pressable>

          {/* 개발 빌드에서만 보인다. 영상 업로드·분석을 지나지 않고 화면만 확인하는 통로. */}
          {__DEV__ && (
            <Pressable
              style={styles.previewRow}
              onPress={() => router.push('/ui-preview')}>
              <Text style={styles.previewText}>UI 미리보기 (개발용)</Text>
            </Pressable>
          )}

          <Pressable style={styles.logout} onPress={() => void confirmLogout()}>
            <Text style={styles.logoutText}>로그아웃</Text>
          </Pressable>

          {/* 깊이 숨기지 않는다 — 앱스토어 심사가 계정 삭제를 앱 안에서 찾을 수 있는지 본다. */}
          <Pressable
            style={styles.deleteRow}
            onPress={() => router.push('/delete-account')}
            accessibilityRole="button">
            <Text style={styles.deleteText}>회원 탈퇴</Text>
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
