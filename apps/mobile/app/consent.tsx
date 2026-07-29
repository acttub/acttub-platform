import { Feather } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KeyboardAwareScroll } from '@/components/keyboard-aware-scroll';
import { api, type ConsentDocument } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { saveConsentPrefs } from '@/lib/consent-prefs';
import { getUserName, saveUserName } from '@/lib/profile';
import { palette } from '@/constants/palette';

/**
 * 약관 동의(가입 마무리) — 로그인 응답의 pending_consents(필수/선택 문서)를 받아 동의를 기록한다.
 * 필수(terms·privacy·ai_analysis 등)는 모두 동의해야 통과, 선택(연구·검토·연락·홍보·모델학습)은 분리 노출.
 * 이름도 함께 받는다(현재는 로컬 저장 — [[profile]], 백엔드 프로필 API 생기면 전송).
 */
export default function ConsentScreen() {
  const { status, pendingConsents, clearPendingConsents, refreshPendingConsents } = useAuth();
  const [name, setName] = useState('');
  const [agreed, setAgreed] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [loadingPending, setLoadingPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPendingConsents = useCallback(async () => {
    setLoadingPending(true);
    setError(null);
    try {
      await refreshPendingConsents();
    } catch (err) {
      setError(err instanceof Error ? err.message : '약관 문서를 불러오지 못했어요.');
    } finally {
      setLoadingPending(false);
    }
  }, [refreshPendingConsents]);

  useEffect(() => {
    if (status !== 'signedIn' || pendingConsents.length > 0) return;
    void loadPendingConsents();
  }, [status, pendingConsents.length, loadPendingConsents]);

  useEffect(() => {
    let active = true;
    void getUserName().then((storedName) => {
      if (active && storedName) setName((current) => current || storedName);
    });
    return () => {
      active = false;
    };
  }, []);

  const required = useMemo(() => pendingConsents.filter((d) => d.required), [pendingConsents]);
  const optional = useMemo(() => pendingConsents.filter((d) => !d.required), [pendingConsents]);

  const canProceed =
    pendingConsents.length > 0 && name.trim().length > 0 && required.every((d) => agreed[d.id]);
  const allChecked = pendingConsents.length > 0 && pendingConsents.every((d) => agreed[d.id]);

  const toggleAll = () => {
    const next = !allChecked;
    setAgreed(Object.fromEntries(pendingConsents.map((d) => [d.id, next])));
  };

  const proceed = async () => {
    setError(null);
    setBusy(true);
    try {
      // 동의한 문서만 granted, 미동의 선택 문서는 declined로 기록.
      for (const doc of pendingConsents) {
        await api.recordConsent(doc.id, agreed[doc.id] ? 'granted' : 'declined');
      }
      await saveUserName(name);
      await saveConsentPrefs(
        Object.fromEntries(pendingConsents.map((d) => [d.id, !!agreed[d.id]])),
      );
      clearPendingConsents();
    } catch (err) {
      setError(err instanceof Error ? err.message : '동의 기록에 실패했어요. 다시 시도해주세요.');
    } finally {
      setBusy(false);
    }
  };

  const renderDoc = (doc: ConsentDocument) => (
    <View key={doc.id} style={styles.docCard}>
      <Pressable
        style={styles.docRow}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: !!agreed[doc.id] }}
        accessibilityLabel={doc.title}
        onPress={() => setAgreed((a) => ({ ...a, [doc.id]: !a[doc.id] }))}>
        <View style={[styles.check, agreed[doc.id] && styles.checkOn]}>
          {agreed[doc.id] && <Feather name="check" size={14} color="#fff" />}
        </View>
        <Text style={styles.docTitle}>{doc.title}</Text>
        <Pressable hitSlop={8} onPress={() => setExpanded((e) => ({ ...e, [doc.id]: !e[doc.id] }))}>
          <Text style={styles.viewLink}>{expanded[doc.id] ? '접기' : '보기'}</Text>
        </Pressable>
      </Pressable>
      {expanded[doc.id] && <Text style={styles.docBody}>{doc.body}</Text>}
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Text style={styles.title}>가입 마무리</Text>
        <Text style={styles.subtitle}>이름과 약관 동의만 하면 시작할 수 있어요.</Text>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* KeyboardAvoidingView가 이미 화면을 줄이므로 키보드 inset을 또 잡으면 두 번 밀린다. */}
        <KeyboardAwareScroll
          contentContainerStyle={styles.list}
          automaticallyAdjustKeyboardInsets={false}>
        <Text style={styles.label}>이름</Text>
        <TextInput
          style={styles.input}
          placeholder="실명 또는 활동명"
          placeholderTextColor={palette.textDim}
          value={name}
          onChangeText={setName}
          returnKeyType="done"
        />

        {pendingConsents.length > 0 && (
          <Pressable
            style={styles.allRow}
            onPress={toggleAll}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: allChecked }}
            accessibilityLabel="약관 전체 동의">
            <View style={[styles.check, allChecked && styles.checkOn]}>
              {allChecked && <Feather name="check" size={14} color="#fff" />}
            </View>
            <Text style={styles.allText}>약관 전체 동의</Text>
          </Pressable>
        )}

        {required.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>필수 동의</Text>
            {required.map(renderDoc)}
          </>
        )}

        {optional.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>선택 동의 · 원하실 때만</Text>
            <Text style={styles.sectionHint}>동의하지 않아도 서비스 이용에는 지장이 없어요.</Text>
            {optional.map(renderDoc)}
          </>
        )}
        </KeyboardAwareScroll>

        {loadingPending && pendingConsents.length === 0 && <ActivityIndicator color={palette.blue} />}
      {error && <Text style={styles.error}>{error}</Text>}
      {error && status === 'signedIn' && pendingConsents.length === 0 && (
        <Pressable
          style={styles.retry}
          onPress={() => void loadPendingConsents()}
          disabled={loadingPending}>
          <Text style={styles.retryText}>다시 불러오기</Text>
        </Pressable>
      )}
        <Pressable
          style={[styles.cta, (!canProceed || busy) && styles.ctaDisabled]}
          onPress={proceed}
          disabled={!canProceed || busy}>
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.ctaText}>동의하고 시작하기</Text>
          )}
        </Pressable>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  flex: { flex: 1 },
  header: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 8 },
  title: { fontSize: 24, fontWeight: '800', color: palette.text },
  subtitle: { fontSize: 14, color: palette.textDim, marginTop: 6, lineHeight: 20 },
  list: { padding: 20, gap: 10 },
  label: { fontSize: 13, fontWeight: '700', color: palette.text, marginBottom: 2 },
  input: {
    backgroundColor: palette.bgSoft,
    borderRadius: 12,
    padding: 14,
    color: palette.text,
    fontSize: 15,
    marginBottom: 6,
  },
  allRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: palette.blueSoft,
    borderRadius: 14,
    marginTop: 4,
  },
  allText: { fontSize: 16, fontWeight: '800', color: palette.text },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: palette.textDim, marginTop: 14 },
  sectionHint: { fontSize: 12, color: palette.textFaint, marginTop: -4, marginBottom: 2 },
  docCard: {
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 14,
    padding: 14,
  },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: palette.textFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: palette.blue, borderColor: palette.blue },
  docTitle: { flex: 1, fontSize: 14, color: palette.text, fontWeight: '600' },
  viewLink: { fontSize: 13, color: palette.textDim, textDecorationLine: 'underline' },
  docBody: {
    fontSize: 13,
    color: palette.textDim,
    lineHeight: 20,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: palette.border,
  },
  error: { color: palette.danger, textAlign: 'center', paddingHorizontal: 20, paddingBottom: 8 },
  retry: { alignSelf: 'center', paddingHorizontal: 16, paddingVertical: 8 },
  retryText: { color: palette.blue, fontSize: 14, fontWeight: '700' },
  cta: {
    backgroundColor: palette.blue,
    borderRadius: 16,
    padding: 17,
    alignItems: 'center',
    margin: 20,
  },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { color: '#fff', fontSize: 16, fontWeight: '800' },
});
