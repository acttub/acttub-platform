import Feather from '@expo/vector-icons/Feather';
import { Stack } from 'expo-router';
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
import { api, type ConsentEntryDocument } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  canSubmitConsentDecisions,
  documentsForConsentEntry,
  submitConsentDecisions,
  type ConsentChoice,
} from '@/lib/consent-entry-submission';
import { setConsentPref } from '@/lib/consent-prefs';
import { translate as t } from '@/lib/i18n';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * A0.1 동의 — pen 대로 문서마다 한 줄(체크 · [필수]/[선택] 제목 · 화살표), 아래에 "전체 동의"와
 * "결정 저장하기". 줄을 누르면 동의가 토글되고, 화살표를 누르면 본문이 펼쳐진다.
 * 제출·재검증 로직은 종전 그대로(consent-entry-submission).
 */
export default function ConsentScreen() {
  const { status, consentEntry, refreshConsentEntry } = useAuth();
  const [choices, setChoices] = useState<Record<string, ConsentChoice>>({});
  const [completedDocumentIds, setCompletedDocumentIds] = useState<Set<string>>(
    new Set(),
  );
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [verificationOnly, setVerificationOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const entry = consentEntry.entry;
  const documents = useMemo(
    () => (entry ? documentsForConsentEntry(entry) : []),
    [entry],
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
  const allGranted =
    documents.length > 0 && documents.every((d) => choices[d.id] === 'granted');

  useEffect(() => {
    setChoices({});
    setCompletedDocumentIds(new Set());
    setVerificationOnly(false);
    setError(null);
  }, [entry]);

  const locked = (id: string) => busy || completedDocumentIds.has(id);

  const toggle = (document: ConsentEntryDocument) => {
    if (locked(document.id)) return;
    setChoices((current) => {
      const now = current[document.id];
      const next = { ...current };
      if (document.required) {
        if (now === 'granted') delete next[document.id];
        else next[document.id] = 'granted';
      } else {
        next[document.id] = now === 'granted' ? 'declined' : 'granted';
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (busy) return;
    setChoices((current) => {
      const next = { ...current };
      for (const d of documents) {
        if (completedDocumentIds.has(d.id)) continue;
        if (allGranted) delete next[d.id];
        else next[d.id] = 'granted';
      }
      return next;
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

  const proceed = async () => {
    if (!entry) return;
    setBusy(true);
    setError(null);
    const previousCompletedIds = completedDocumentIds;
    const result = await submitConsentDecisions({
      documents,
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

  const renderRow = (document: ConsentEntryDocument) => {
    const granted = choices[document.id] === 'granted';
    const declined = choices[document.id] === 'declined';
    const isLocked = locked(document.id);
    const open = !!expanded[document.id];
    return (
      <View key={document.id}>
        <Pressable
          style={[styles.row, isLocked && styles.rowLocked]}
          onPress={() => toggle(document)}
          disabled={isLocked}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: granted, disabled: isLocked }}>
          <Feather
            name={declined ? 'x' : 'check'}
            size={18}
            color={granted ? palette.blue : declined ? palette.danger : palette.checkOff}
          />
          <Text style={[styles.rowLabel, granted && styles.rowLabelOn]} numberOfLines={1}>
            {t(document.required ? 'consent.requiredTag' : 'consent.optionalTag')} {document.title}
          </Text>
          <Pressable
            hitSlop={10}
            onPress={() =>
              setExpanded((current) => ({ ...current, [document.id]: !current[document.id] }))
            }
            accessibilityRole="button"
            accessibilityLabel={open ? t('common.fold') : t('common.view')}>
            <Feather name={open ? 'chevron-down' : 'chevron-right'} size={18} color={palette.checkOff} />
          </Pressable>
        </Pressable>
        {open && (
          <View style={styles.docBody}>
            <Markdown source={document.body} variant="compact" />
          </View>
        )}
      </View>
    );
  };

  const waiting = status === 'signedIn' && consentEntry.status === 'checking';
  const loadFailed = consentEntry.status === 'error';

  return (
    <SafeAreaView style={styles.safe}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Text style={styles.title}>
          {entry?.entry_status === 'blocked'
            ? t('consent.blockedTitle')
            : t('consent.title')}
        </Text>
        <Text style={styles.subtitle}>
          {entry?.entry_status === 'blocked'
            ? t('consent.blockedSubtitle')
            : t('consent.subtitle')}
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
            <Pressable
              style={[styles.allRow, allGranted && styles.allRowOn]}
              onPress={toggleAll}
              disabled={busy}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: allGranted }}>
              <Feather name="check-circle" size={20} color={allGranted ? palette.blue : palette.checkOff} />
              <Text style={[styles.allLabel, allGranted && styles.allLabelOn]}>{t('consent.allAgreeShort')}</Text>
            </Pressable>
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: palette.borderSoft,
  },
  rowLocked: { opacity: 0.6 },
  rowLabel: { flex: 1, fontSize: 15, fontWeight: '600', color: palette.textDim },
  rowLabelOn: { color: palette.text },
  docBody: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: palette.borderSoft },
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
});
