import Feather from '@expo/vector-icons/Feather';
import { Stack, useRouter, type Href } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Markdown } from '@/components/markdown';
import { palette } from '@/constants/palette';
import { api, type ConsentDocument } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  canSubmitConsentDecisions,
  documentsForConsentEntry,
  grantAllRequired,
  signupFailureAction,
  submitConsentDecisions,
  type ConsentChoice,
} from '@/lib/consent-entry-submission';
import { setConsentPref } from '@/lib/consent-prefs';
import { translate as t } from '@/lib/i18n';
import { loginErrorMessage } from '@/lib/login-flow';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * A0.1 동의 — 문서마다 한 줄. 필수 문서는 체크 · [필수] 제목 · 화살표이고 거절이 없다. 선택
 * 문서는 기본값 없이 동의·거절 두 버튼이다. 필수 셋에 동의하고 선택 문서를 결정해야
 * "동의하고 계속하기"가 켜진다. 화살표를 누르면 본문이 펼쳐진다.
 *
 * 두 경우에 뜬다.
 * - 가입 중(처음 온 신원): 로그인 응답의 문서를 보여 주고, 제출이 통과하는 순간 계정이
 *   생긴다(POST /v2/auth/signup, 모든 결정을 한 번에). 나가면 아무것도 남지 않는다.
 * - 재동의(이미 있는 계정에 새 판): 미결정 문서만 보여 주고 문서 하나씩 기록한다
 *   (consent-entry-submission). 동의하지 않는 사람이 떠날 길로 탈퇴 링크를 둔다.
 */
export default function ConsentScreen() {
  const router = useRouter();
  const {
    status,
    consentEntry,
    refreshConsentEntry,
    signup,
    submitSignup,
    reloadSignupDocuments,
    cancelSignup,
  } = useAuth();
  const [choices, setChoices] = useState<Record<string, ConsentChoice>>({});
  const [completedDocumentIds, setCompletedDocumentIds] = useState<Set<string>>(
    new Set(),
  );
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [verificationOnly, setVerificationOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signingUp = signup !== null;
  const entry = consentEntry.entry;
  const signupDocuments = signup?.documents;
  const documents = useMemo<ConsentDocument[]>(
    () => signupDocuments ?? (entry ? documentsForConsentEntry(entry) : []),
    [signupDocuments, entry],
  );
  // 필수를 먼저, 선택을 뒤에 — 한 목록으로 보여준다.
  const ordered = useMemo(
    () => [...documents.filter((d) => d.required), ...documents.filter((d) => !d.required)],
    [documents],
  );
  const choiceMap = useMemo(
    () => new Map(Object.entries(choices)),
    [choices],
  );
  const canProceed = canSubmitConsentDecisions(documents, choiceMap);
  const requiredDocuments = documents.filter((d) => d.required);
  const allRequiredGranted =
    requiredDocuments.length > 0 && requiredDocuments.every((d) => choices[d.id] === 'granted');

  useEffect(() => {
    setChoices({});
    setCompletedDocumentIds(new Set());
    setVerificationOnly(false);
    setError(null);
  }, [entry, signupDocuments]);

  const locked = (id: string) => busy || completedDocumentIds.has(id);

  // 필수 문서는 동의만 된다. 다시 누르면 동의를 거둔다.
  const toggleRequired = (document: ConsentDocument) => {
    if (locked(document.id)) return;
    setChoices((current) => {
      const next = { ...current };
      if (current[document.id] === 'granted') delete next[document.id];
      else next[document.id] = 'granted';
      return next;
    });
  };

  // 선택 문서는 기본값이 없다. 동의·거절 중 하나를 직접 고른다(거절도 결정이다).
  const choose = (document: ConsentDocument, choice: ConsentChoice) => {
    if (locked(document.id)) return;
    setChoices((current) => ({ ...current, [document.id]: choice }));
  };

  const toggleAllRequired = () => {
    if (busy) return;
    setChoices((current) => {
      if (allRequiredGranted) {
        const next = { ...current };
        for (const d of requiredDocuments) {
          if (!completedDocumentIds.has(d.id)) delete next[d.id];
        }
        return next;
      }
      return Object.fromEntries(
        grantAllRequired(documents, new Map(Object.entries(current)), completedDocumentIds),
      );
    });
  };

  const rememberCompletedChoices = async (documentIds: readonly string[]) => {
    await Promise.all(
      documentIds.map(async (documentId) => {
        const choice = choiceMap.get(documentId);
        if (!choice) return;
        await setConsentPref(documentId, choice === 'granted').catch(() => undefined);
      }),
    );
  };

  const reload = async () => {
    setBusy(true);
    setError(null);
    try {
      await refreshConsentEntry();
      setVerificationOnly(false);
    } catch (cause) {
      setError(errorMessage(cause, t('consent.docFail')));
    } finally {
      setBusy(false);
    }
  };

  const proceedSignup = async () => {
    setBusy(true);
    setError(null);
    try {
      await submitSignup(choiceMap);
    } catch (cause) {
      const action = signupFailureAction(cause);
      if (action === 'restart_login') {
        // 가입 토큰 만료(30분)나 이메일 겹침. 로그인 버튼부터 다시 시작한다.
        const expired = (cause as { code?: string })?.code === 'invalid_signup_token';
        cancelSignup(expired ? t('login.signupExpired') : loginErrorMessage(cause));
        return;
      }
      if (action === 'reload_documents') {
        // 보는 사이 새 판이 나왔다. 문서를 다시 받아 화면을 새로 그린다.
        setError(t('consent.outdated'));
        await reloadSignupDocuments().catch(() => undefined);
      } else {
        setError(errorMessage(cause, t('consent.agreeFail')));
      }
    } finally {
      setBusy(false);
    }
  };

  const proceed = async () => {
    if (signingUp) return proceedSignup();
    if (!entry) return;
    setBusy(true);
    setError(null);
    const previousCompletedIds = completedDocumentIds;
    const result = await submitConsentDecisions({
      documents: documentsForConsentEntry(entry),
      choices: choiceMap,
      completedDocumentIds,
      recordDecision: (documentId, action) =>
        api.recordConsent(documentId, action),
      refreshEntry: refreshConsentEntry,
    });
    const nextCompletedIds = new Set(result.completedDocumentIds);
    setCompletedDocumentIds(nextCompletedIds);
    await rememberCompletedChoices(
      result.completedDocumentIds.filter(
        (documentId) => !previousCompletedIds.has(documentId),
      ),
    );

    if (result.kind === 'partial') {
      setError(t('consent.partialFail'));
    } else if (result.kind === 'verification_failed') {
      setVerificationOnly(true);
      setError(errorMessage(result.cause, t('consent.verifyFail')));
    }
    setBusy(false);
  };

  const renderRow = (document: ConsentDocument) => {
    const granted = choices[document.id] === 'granted';
    const declined = choices[document.id] === 'declined';
    const isLocked = locked(document.id);
    const open = !!expanded[document.id];
    const label = `${t(document.required ? 'consent.requiredTag' : 'consent.optionalTag')} ${document.title}`;
    const chevron = (
      <Pressable
        hitSlop={10}
        onPress={() =>
          setExpanded((current) => ({ ...current, [document.id]: !current[document.id] }))
        }
        accessibilityRole="button"
        accessibilityLabel={open ? t('common.fold') : t('common.view')}>
        <Feather name={open ? 'chevron-down' : 'chevron-right'} size={18} color={palette.checkOff} />
      </Pressable>
    );
    return (
      <View key={document.id} style={styles.rowWrap}>
        {document.required ? (
          <Pressable
            style={[styles.row, isLocked && styles.rowLocked]}
            onPress={() => toggleRequired(document)}
            disabled={isLocked}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: granted, disabled: isLocked }}>
            <Feather name="check" size={18} color={granted ? palette.blue : palette.checkOff} />
            <Text style={[styles.rowLabel, granted && styles.rowLabelOn]} numberOfLines={1}>
              {label}
            </Text>
            {chevron}
          </Pressable>
        ) : (
          <View style={[styles.optionalRow, isLocked && styles.rowLocked]}>
            <View style={styles.optionalHead}>
              <Text
                style={[styles.rowLabel, (granted || declined) && styles.rowLabelOn]}
                numberOfLines={2}>
                {label}
              </Text>
              {chevron}
            </View>
            <View style={styles.choiceRow} accessibilityRole="radiogroup">
              {(['granted', 'declined'] as ConsentChoice[]).map((choice) => {
                const selected = choices[document.id] === choice;
                return (
                  <Pressable
                    key={choice}
                    style={[styles.choice, selected && styles.choiceOn]}
                    onPress={() => choose(document, choice)}
                    disabled={isLocked}
                    accessibilityRole="radio"
                    accessibilityState={{ selected, disabled: isLocked }}>
                    <Text style={[styles.choiceText, selected && styles.choiceTextOn]}>
                      {t(choice === 'granted' ? 'consent.accept' : 'consent.decline')}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}
        {open && (
          <View style={styles.docBody}>
            <Markdown source={document.body} variant="compact" />
          </View>
        )}
      </View>
    );
  };

  const waiting = !signingUp && status === 'signedIn' && consentEntry.status === 'checking';
  const loadFailed = !signingUp && consentEntry.status === 'error';

  return (
    <SafeAreaView style={styles.safe}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        {signingUp && (
          // 가입 중에는 나가면 아무것도 남지 않는다. 계정도, 제공자가 준 이름도.
          <Pressable
            style={styles.exit}
            onPress={() => cancelSignup()}
            disabled={busy}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={t('consent.exit')}>
            <Feather name="chevron-left" size={26} color={palette.text} />
          </Pressable>
        )}
        <Text style={styles.title}>{t('consent.title')}</Text>
        <Text style={styles.subtitle}>
          {signingUp ? t('consent.subtitle') : t('consent.reconsentSubtitle')}
        </Text>
      </View>

      {waiting ? (
        <View style={styles.center}>
          <ActivityIndicator color={palette.blue} />
        </View>
      ) : loadFailed ? (
        <View style={styles.center}>
          <Text style={styles.error}>
            {error ?? errorMessage(consentEntry.error, t('consent.docFail'))}
          </Text>
          <Pressable style={styles.retry} onPress={() => void reload()} disabled={busy}>
            <Text style={styles.retryText}>{t('consent.reload')}</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.list}>
            <Text style={styles.sectionTitle}>{t('consent.itemsLabel')}</Text>
            {ordered.map(renderRow)}
            {documents.some((d) => !d.required) && (
              <Text style={styles.sectionHint}>{t('consent.optionalHint')}</Text>
            )}
          </ScrollView>

          <View style={styles.footer}>
            {error && <Text style={styles.error}>{error}</Text>}
            {requiredDocuments.length > 0 && (
              <Pressable
                style={[styles.allRow, allRequiredGranted && styles.allRowOn]}
                onPress={toggleAllRequired}
                disabled={busy}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: allRequiredGranted }}>
                <Feather
                  name="check-circle"
                  size={20}
                  color={allRequiredGranted ? palette.blue : palette.checkOff}
                />
                <Text style={[styles.allLabel, allRequiredGranted && styles.allLabelOn]}>
                  {t('consent.allAgreeShort')}
                </Text>
              </Pressable>
            )}
            <Pressable
              style={[
                styles.cta,
                ((!canProceed && !verificationOnly) || busy) && styles.ctaDisabled,
              ]}
              onPress={() => void (verificationOnly ? reload() : proceed())}
              disabled={(!canProceed && !verificationOnly) || busy}>
              {busy ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.ctaText}>
                  {verificationOnly ? t('consent.verifyAgain') : t('consent.cta')}
                </Text>
              )}
            </Pressable>
            {!signingUp && (
              // 필수 문서에 거절이 없고 설정은 이 화면 뒤에 있다. 떠나는 길은 이것뿐이다.
              <Pressable
                style={styles.withdrawLink}
                onPress={() => router.push('/delete-account' as Href)}
                disabled={busy}
                accessibilityRole="link">
                <Text style={styles.withdrawText}>{t('consent.withdrawLink')}</Text>
              </Pressable>
            )}
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  header: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 8 },
  title: { fontSize: 24, fontWeight: '800', color: palette.text },
  subtitle: { fontSize: 14, color: palette.textDim, marginTop: 6, lineHeight: 20 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  list: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 16 },
  sectionTitle: { fontSize: 12.5, fontWeight: '800', color: palette.textDim, marginBottom: 6 },
  sectionHint: { fontSize: 12, color: palette.textFaint, marginTop: 10 },
  exit: { alignSelf: 'flex-start', marginLeft: -6, marginBottom: 12 },
  rowWrap: { borderBottomWidth: 1, borderBottomColor: palette.borderSoft },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 16,
  },
  rowLocked: { opacity: 0.6 },
  optionalRow: { paddingVertical: 16, gap: 12 },
  optionalHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  choiceRow: { flexDirection: 'row', gap: 8 },
  choice: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.bg,
    paddingVertical: 12,
  },
  choiceOn: { backgroundColor: palette.blueSoft, borderColor: palette.blue },
  choiceText: { fontSize: 14, fontWeight: '700', color: palette.textDim },
  choiceTextOn: { color: palette.blueDeep },
  rowLabel: { flex: 1, fontSize: 15, fontWeight: '600', color: palette.textDim },
  rowLabelOn: { color: palette.text },
  docBody: { paddingBottom: 12 },
  footer: { paddingHorizontal: 20, paddingBottom: 16, gap: 12 },
  allRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: palette.bgSubtle,
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  allRowOn: { backgroundColor: palette.blueSoft },
  allLabel: { fontSize: 15, fontWeight: '800', color: palette.textDim },
  allLabelOn: { color: palette.blueDeep },
  error: { color: palette.danger, textAlign: 'center', paddingHorizontal: 4 },
  retry: { paddingHorizontal: 16, paddingVertical: 8 },
  retryText: { color: palette.blue, fontSize: 14, fontWeight: '700' },
  cta: {
    backgroundColor: palette.blue,
    borderRadius: 16,
    padding: 17,
    alignItems: 'center',
  },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  withdrawLink: { alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 12 },
  withdrawText: { color: palette.textDim, fontSize: 13, textDecorationLine: 'underline' },
});
