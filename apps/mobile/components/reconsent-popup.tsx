import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConsentRow } from '@/components/consent-row';
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
import { translate as t } from '@/lib/i18n';
import {
  entryMarketingDecisions,
  marketingDecisionNotice,
  shouldNoticeEntryDecisions,
} from '@/lib/marketing-consent';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function requiredFirst(documents: ConsentEntryDocument[]): ConsentEntryDocument[] {
  return [...documents.filter((d) => d.required), ...documents.filter((d) => !d.required)];
}

/**
 * 재동의 팝업 — 이미 있는 계정에 새 판 문서가 나왔을 때 홈(또는 쓰던 화면) 위에 뜬다.
 *
 * 미결정 문서가 있으면 서버가 보호 API를 403 consent_required로 막아 뒤 화면은 데이터를 못
 * 불러온다. 그래서 닫기·뒤로 가기·탈퇴 링크 없이 결정해야만 사라진다(출구 없음은 결정이다).
 * 문서는 하나씩 기록한다(consent-entry-submission). 일부만 저장되면 저장된 줄은 잠그고
 * 실패한 줄의 체크만 풀어 다시 누르게 한다.
 */
export function ReconsentPopup({ visible }: { visible: boolean }) {
  const { consentEntry, refreshConsentEntry } = useAuth();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const entry = consentEntry.entry;
  // 저장 결과를 다시 읽는 사이 entry가 비어도 목록은 마지막 것을 보여 준다.
  const [documents, setDocuments] = useState<ConsentEntryDocument[]>(() =>
    entry ? requiredFirst(documentsForConsentEntry(entry)) : [],
  );
  const [choices, setChoices] = useState<Record<string, ConsentChoice>>({});
  const [completedDocumentIds, setCompletedDocumentIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [verificationOnly, setVerificationOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openDocument, setOpenDocument] = useState<ConsentEntryDocument | null>(null);

  useEffect(() => {
    if (!entry) return;
    setDocuments(requiredFirst(documentsForConsentEntry(entry)));
    setChoices({});
    setCompletedDocumentIds(new Set());
    setVerificationOnly(false);
    setError(null);
  }, [entry]);

  const choiceMap = useMemo(() => new Map(Object.entries(choices)), [choices]);
  const canProceed = canSubmitConsentDecisions(documents, choiceMap);
  const locked = (id: string) => busy || completedDocumentIds.has(id);

  const toggleDocument = (document: ConsentEntryDocument) => {
    if (locked(document.id)) return;
    setChoices((current) => {
      const next = { ...current };
      if (current[document.id] === 'granted') delete next[document.id];
      else next[document.id] = 'granted';
      return next;
    });
  };

  const verifyAgain = () => {
    refreshConsentEntry().catch((cause) => setError(errorMessage(cause, t('consent.verifyFail'))));
  };

  const proceed = async () => {
    setBusy(true);
    setError(null);
    const result = await submitConsentDecisions({
      documents,
      choices: choiceMap,
      completedDocumentIds,
      recordDecision: (documentId, action) => api.recordConsent(documentId, action),
      refreshEntry: refreshConsentEntry,
    });
    setCompletedDocumentIds(new Set(result.completedDocumentIds));
    if (result.kind === 'partial') {
      setChoices((current) => {
        const next = { ...current };
        for (const failed of result.failedDocuments) delete next[failed.id];
        return next;
      });
    } else if (result.kind === 'verified') {
      // 광고성 정보 수신에 동의했으면 처리 결과를 알린다(정보통신망법 제50조 제7항). 저장이 확인되면 팝업이
      // 닫히므로 앱 다이얼로그 대신 OS 알림창을 쓴다.
      const decisions = entryMarketingDecisions(documents, choiceMap);
      const notice = shouldNoticeEntryDecisions(decisions)
        ? marketingDecisionNotice(decisions, new Date())
        : null;
      if (notice) Alert.alert(notice.title, notice.message);
    } else if (result.kind === 'verification_failed') {
      setVerificationOnly(true);
      setError(errorMessage(result.cause, t('consent.verifyFail')));
    }
    setBusy(false);
  };

  const renderBody = () => {
    if (consentEntry.status === 'checking') {
      return (
        <View style={styles.checking}>
          <ActivityIndicator color={palette.blue} />
        </View>
      );
    }
    if (consentEntry.status === 'error' && !verificationOnly) {
      return (
        <View style={styles.loadFailed}>
          <Text style={styles.error}>
            {errorMessage(consentEntry.error, t('consent.docFail'))}
          </Text>
          <Pressable
            style={styles.retry}
            onPress={() => void refreshConsentEntry().catch(() => undefined)}
            accessibilityRole="button">
            <Text style={styles.retryText}>{t('consent.reload')}</Text>
          </Pressable>
        </View>
      );
    }
    const ctaDisabled = (!canProceed && !verificationOnly) || busy;
    return (
      <>
        <ScrollView style={styles.list}>
          {documents.map((document) => (
            <ConsentRow
              key={document.id}
              label={`${t(document.required ? 'consent.requiredTag' : 'consent.optionalTag')} ${document.title}`}
              checked={choices[document.id] === 'granted'}
              locked={locked(document.id)}
              onToggle={() => toggleDocument(document)}
              arrow={{
                icon: 'chevron-right',
                onPress: () => setOpenDocument(document),
                accessibilityLabel: t('common.view'),
              }}
            />
          ))}
        </ScrollView>
        <View style={styles.footer}>
          {error && <Text style={styles.error}>{error}</Text>}
          <Pressable
            style={[styles.cta, ctaDisabled && styles.ctaDisabled]}
            onPress={() => (verificationOnly ? verifyAgain() : void proceed())}
            disabled={ctaDisabled}
            accessibilityRole="button">
            {busy ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.ctaText}>
                {verificationOnly
                  ? t('consent.verifyAgain')
                  : documents.some((d) => d.required)
                    ? t('consent.cta')
                    : t('consent.ctaOptionalOnly')}
              </Text>
            )}
          </Pressable>
        </View>
      </>
    );
  };

  return (
    <Modal
      transparent
      statusBarTranslucent
      visible={visible}
      animationType="fade"
      // 문서 시트만 닫는다. 팝업 자체는 결정해야만 사라진다.
      onRequestClose={() => setOpenDocument(null)}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { maxHeight: height * 0.85 }]}>
          <View style={styles.head}>
            <Text style={styles.title}>{t('consent.reconsentTitle')}</Text>
            <Text style={styles.subtitle}>{t('consent.reconsentSubtitle')}</Text>
          </View>
          {renderBody()}
        </View>
      </View>
      {openDocument && (
        <View style={styles.sheetLayer}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpenDocument(null)} />
          <View
            style={[styles.sheet, { maxHeight: height * 0.8, paddingBottom: 16 + insets.bottom }]}>
            <Text style={styles.sheetTitle}>{openDocument.title}</Text>
            <ScrollView style={styles.sheetBody}>
              <Markdown source={openDocument.body} />
            </ScrollView>
            <Pressable
              style={({ pressed }) => [styles.sheetClose, pressed && styles.pressed]}
              onPress={() => setOpenDocument(null)}
              accessibilityRole="button">
              <Text style={styles.sheetCloseText}>{t('common.close')}</Text>
            </Pressable>
          </View>
        </View>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 21, 37, 0.45)',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  card: {
    backgroundColor: palette.card,
    borderRadius: 22,
    paddingTop: 24,
    paddingHorizontal: 20,
    paddingBottom: 16,
    gap: 16,
  },
  head: { gap: 6 },
  title: { fontSize: 19, fontWeight: '800', color: palette.text },
  subtitle: { fontSize: 14, color: palette.textDim },
  list: { flexGrow: 0, flexShrink: 1 },
  checking: { paddingVertical: 24, alignItems: 'center' },
  loadFailed: { alignItems: 'center', gap: 4 },
  error: { fontSize: 14, color: palette.danger, textAlign: 'center' },
  retry: { paddingHorizontal: 16, paddingVertical: 8 },
  retryText: { color: palette.blue, fontSize: 14, fontWeight: '700' },
  footer: { gap: 12 },
  cta: {
    backgroundColor: palette.blue,
    borderRadius: 16,
    padding: 17,
    alignItems: 'center',
  },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  pressed: { opacity: 0.75 },

  sheetLayer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 21, 37, 0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: palette.card,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 20,
    paddingHorizontal: 20,
    gap: 12,
  },
  sheetTitle: { fontSize: 17, fontWeight: '800', color: palette.text },
  sheetBody: { flexGrow: 0, flexShrink: 1 },
  sheetClose: {
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: palette.bgSoft,
    borderRadius: 14,
  },
  sheetCloseText: { fontSize: 15, fontWeight: '800', color: palette.textDim },
});
