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
  const choiceMap = useMemo(
    () => new Map(Object.entries(choices)),
    [choices],
  );
  const requiredDocuments = useMemo(
    () => documents.filter((document) => document.required),
    [documents],
  );
  const optionalDocuments = useMemo(
    () => documents.filter((document) => !document.required),
    [documents],
  );
  const canProceed = canSubmitConsentDecisions(documents, choiceMap);

  useEffect(() => {
    setChoices({});
    setCompletedDocumentIds(new Set());
    setVerificationOnly(false);
    setError(null);
  }, [entry]);

  const choose = (documentId: string, choice: ConsentChoice) => {
    if (busy) return;
    setChoices((current) => ({ ...current, [documentId]: choice }));
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

  const renderDocument = (document: ConsentEntryDocument) => {
    const choice = choices[document.id];
    const completed = completedDocumentIds.has(document.id);
    return (
      <View key={document.id} style={styles.docCard}>
        <View style={styles.docHead}>
          <Text style={styles.docTitle}>{document.title}</Text>
          <Pressable
            hitSlop={8}
            onPress={() =>
              setExpanded((current) => ({
                ...current,
                [document.id]: !current[document.id],
              }))
            }>
            <Text style={styles.viewLink}>
              {expanded[document.id] ? t('common.fold') : t('common.view')}
            </Text>
          </Pressable>
        </View>

        {document.required ? (
          <Pressable
            style={[
              styles.requiredChoice,
              (completed || busy) && styles.choiceDisabled,
            ]}
            onPress={() => choose(document.id, 'granted')}
            disabled={completed || busy}
            accessibilityRole="checkbox"
            accessibilityState={{
              checked: choice === 'granted',
              disabled: completed || busy,
            }}>
            <View style={[styles.check, choice === 'granted' && styles.checkOn]}>
              {choice === 'granted' && <Feather name="check" size={14} color="#FFFFFF" />}
            </View>
            <Text style={styles.choiceLabel}>{t('consent.acceptRequired')}</Text>
          </Pressable>
        ) : (
          <View style={styles.optionalChoices}>
            {(['granted', 'declined'] as const).map((candidate) => {
              const selected = choice === candidate;
              return (
                <Pressable
                  key={candidate}
                  style={[
                    styles.choiceButton,
                    selected && styles.choiceButtonSelected,
                    (completed || busy) && styles.choiceDisabled,
                  ]}
                  onPress={() => choose(document.id, candidate)}
                  disabled={completed || busy}
                  accessibilityRole="button"
                  accessibilityState={{ selected, disabled: completed || busy }}>
                  <Text style={[styles.choiceButtonText, selected && styles.choiceButtonTextSelected]}>
                    {candidate === 'granted' ? t('consent.accept') : t('consent.decline')}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {completed && <Text style={styles.saved}>{t('common.saved')}</Text>}
        {expanded[document.id] && (
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
            {requiredDocuments.length > 0 && (
              <Text style={styles.sectionTitle}>{t('consent.required')}</Text>
            )}
            {requiredDocuments.map(renderDocument)}

            {optionalDocuments.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>{t('consent.optional')}</Text>
                <Text style={styles.sectionHint}>{t('consent.optionalHint')}</Text>
              </>
            )}
            {optionalDocuments.map(renderDocument)}
          </ScrollView>

          {error && <Text style={styles.error}>{error}</Text>}
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
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  header: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 8 },
  title: { fontSize: 24, fontWeight: '800', color: palette.text },
  subtitle: { fontSize: 14, color: palette.textDim, marginTop: 6, lineHeight: 20 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  list: { padding: 20, gap: 10 },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: palette.textDim, marginTop: 14 },
  sectionHint: { fontSize: 12, color: palette.textFaint, marginTop: -4, marginBottom: 2 },
  docCard: {
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 14,
    padding: 14,
    gap: 12,
  },
  docHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  docTitle: { flex: 1, fontSize: 14, color: palette.text, fontWeight: '600' },
  viewLink: { fontSize: 13, color: palette.textDim, textDecorationLine: 'underline' },
  requiredChoice: { flexDirection: 'row', alignItems: 'center', gap: 10 },
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
  choiceLabel: { color: palette.text, fontSize: 14, fontWeight: '600' },
  optionalChoices: { flexDirection: 'row', gap: 8 },
  choiceButton: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    paddingVertical: 11,
  },
  choiceButtonSelected: { backgroundColor: palette.blueSoft, borderColor: palette.blue },
  choiceButtonText: { color: palette.textDim, fontSize: 14, fontWeight: '700' },
  choiceButtonTextSelected: { color: palette.blue },
  choiceDisabled: { opacity: 0.6 },
  saved: { color: palette.blue, fontSize: 12, fontWeight: '700' },
  docBody: { paddingTop: 12, borderTopWidth: 1, borderTopColor: palette.border },
  error: { color: palette.danger, textAlign: 'center', paddingHorizontal: 20, paddingBottom: 8 },
  retry: { paddingHorizontal: 16, paddingVertical: 8 },
  retryText: { color: palette.blue, fontSize: 14, fontWeight: '700' },
  cta: {
    backgroundColor: palette.blue,
    borderRadius: 16,
    padding: 17,
    alignItems: 'center',
    margin: 20,
  },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
});
