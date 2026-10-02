import Feather from '@expo/vector-icons/Feather';
import { Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConsentRow } from '@/components/consent-row';
import { Markdown } from '@/components/markdown';
import { palette } from '@/constants/palette';
import type { ConsentDocument } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  canSubmitConsentDecisions,
  grantAllRequired,
  signupFailureAction,
  type ConsentChoice,
} from '@/lib/consent-entry-submission';
import { translate as t } from '@/lib/i18n';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * A0.1 가입 동의 — 처음 온 신원만 본다. 이미 있는 계정의 새 판 동의는 홈 위 재동의 팝업이 묻는다.
 *
 * 맨 위에 만 14세 확인 줄, 그 아래 문서마다 체크 한 줄(필수를 먼저). 만 14세 확인과 필수 문서에
 * 모두 동의해야 "동의하고 계속하기"가 켜진다. 화살표를 누르면 본문이 펼쳐진다.
 * 로그인 응답의 문서를 보여 주고, 제출이 통과하는 순간 계정이 생긴다(POST /v2/auth/signup,
 * 모든 결정을 한 번에). 나가면 아무것도 남지 않는다.
 */
export default function ConsentScreen() {
  const { signup, submitSignup, reloadSignupDocuments, cancelSignup } = useAuth();
  const [choices, setChoices] = useState<Record<string, ConsentChoice>>({});
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const documents = useMemo<ConsentDocument[]>(() => signup?.documents ?? [], [signup?.documents]);
  // 필수를 먼저, 선택을 뒤에 — 한 목록으로 보여준다.
  const ordered = useMemo(
    () => [...documents.filter((d) => d.required), ...documents.filter((d) => !d.required)],
    [documents],
  );
  const choiceMap = useMemo(() => new Map(Object.entries(choices)), [choices]);
  const canProceed = canSubmitConsentDecisions(documents, choiceMap) && ageConfirmed;
  const requiredDocuments = documents.filter((d) => d.required);
  const allRequiredGranted =
    ageConfirmed && requiredDocuments.every((d) => choices[d.id] === 'granted');

  useEffect(() => {
    setChoices({});
    setError(null);
  }, [documents]);

  /** 필수·선택 모두 같은 토글이다. 체크하면 동의, 지우면 결정을 비운다. */
  const toggleDocument = (document: ConsentDocument) => {
    if (busy) return;
    setChoices((current) => {
      const next = { ...current };
      if (current[document.id] === 'granted') delete next[document.id];
      else next[document.id] = 'granted';
      return next;
    });
  };

  const toggleAllRequired = () => {
    if (busy) return;
    setAgeConfirmed(!allRequiredGranted);
    setChoices((current) => {
      if (allRequiredGranted) {
        const next = { ...current };
        for (const d of requiredDocuments) delete next[d.id];
        return next;
      }
      return Object.fromEntries(grantAllRequired(documents, new Map(Object.entries(current))));
    });
  };

  const proceed = async () => {
    setBusy(true);
    setError(null);
    try {
      await submitSignup(choiceMap);
    } catch (cause) {
      if (signupFailureAction(cause) === 'reload_documents') {
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

  if (!signup) return null;

  const renderRow = (document: ConsentDocument) => {
    const open = !!expanded[document.id];
    return (
      <ConsentRow
        key={document.id}
        label={`${t(document.required ? 'consent.requiredTag' : 'consent.optionalTag')} ${document.title}`}
        checked={choices[document.id] === 'granted'}
        locked={busy}
        onToggle={() => toggleDocument(document)}
        arrow={{
          icon: open ? 'chevron-down' : 'chevron-right',
          onPress: () =>
            setExpanded((current) => ({ ...current, [document.id]: !current[document.id] })),
          accessibilityLabel: open ? t('common.fold') : t('common.view'),
        }}>
        {open && (
          <View style={styles.docBody}>
            <Markdown source={document.body} />
          </View>
        )}
      </ConsentRow>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        {/* 나가면 아무것도 남지 않는다. 계정도, 제공자가 준 이름도. */}
        <Pressable
          style={styles.exit}
          onPress={() => cancelSignup()}
          disabled={busy}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t('consent.exit')}>
          <Feather name="chevron-left" size={26} color={palette.text} />
        </Pressable>
        <Text style={styles.title}>{t('consent.title')}</Text>
        <Text style={styles.subtitle}>{t('consent.subtitle')}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        <Text style={styles.sectionTitle}>{t('consent.itemsLabel')}</Text>
        <ConsentRow
          label={`${t('consent.requiredTag')} ${t('consent.ageConfirm')}`}
          checked={ageConfirmed}
          locked={busy}
          onToggle={() => setAgeConfirmed((current) => !current)}
        />
        {ordered.map(renderRow)}
      </ScrollView>

      <View style={styles.footer}>
        {error && <Text style={styles.error}>{error}</Text>}
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
        <Pressable
          style={[styles.cta, (!canProceed || busy) && styles.ctaDisabled]}
          onPress={() => void proceed()}
          disabled={!canProceed || busy}>
          {busy ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.ctaText}>{t('consent.cta')}</Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  header: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 8 },
  title: { fontSize: 24, fontWeight: '800', color: palette.text },
  subtitle: { fontSize: 14, color: palette.textDim, marginTop: 6, lineHeight: 20 },
  list: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 16 },
  sectionTitle: { fontSize: 12.5, fontWeight: '800', color: palette.textDim, marginBottom: 6 },
  exit: { alignSelf: 'flex-start', marginLeft: -6, marginBottom: 12 },
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
  cta: {
    backgroundColor: palette.blue,
    borderRadius: 16,
    padding: 17,
    alignItems: 'center',
  },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
});
