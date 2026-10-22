import Feather from '@expo/vector-icons/Feather';
import { Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConsentRow } from '@/components/consent-row';
import { Markdown } from '@/components/markdown';
import { PrimaryButton } from '@/components/ui/buttons';
import { CtaBar } from '@/components/ui/cta-bar';
import { BackTitleHeader, BareBackButton } from '@/components/ui/nav-header';
import { palette } from '@/constants/palette';
import type { ConsentDocument } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  canSubmitConsentDecisions,
  signupFailureAction,
  signupScreenLayout,
  toggleConsentGroup,
  type ConsentChoice,
} from '@/lib/consent-entry-submission';
import { translate as t } from '@/lib/i18n';
import {
  entryMarketingDecisions,
  marketingDecisionNotice,
  shouldNoticeEntryDecisions,
} from '@/lib/marketing-consent';
import { showMarketingNotice } from '@/lib/marketing-notice';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * A0.1 가입 동의(pen 01 「약관 동의」, 파이프라인 반영버전) — 처음 온 신원만 본다. 이미 있는 계정의 새 판 동의는 홈 위 재동의 팝업이 묻는다.
 *
 * 제목 아래 파란 안내 줄이 지금 누를 곳을 알려 준다 — 필수를 다 고르기 전엔 「전체 동의」, 다 고르면 「동의하고 계속하기」.
 * 맨 위에 전체 동의(선택 포함, 기본 꺼짐), 그 아래 만 14세 확인 줄과 문서마다 체크 한 줄(필수를 먼저).
 * 고품질 목소리·대본 나누기는 개인정보 동의 v9에 들어 있어 따로 보이지 않고, 광고성 이메일·앱 푸시는 한 줄로 묶는다. 만 14세 확인과 필수 문서에
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
  // 필수를 먼저, 선택을 뒤에. 고품질 목소리·대본 나누기는 개인정보 동의 v9에 합쳐져 따로 묻지 않고,
  // 광고성 정보 수신(이메일·앱 푸시)은 한 줄로 묶는다. 빠진 문서는 제출 때 거절로 채워진다.
  const layout = useMemo(() => signupScreenLayout(documents), [documents]);
  const ordered = useMemo(() => [...layout.required, ...layout.optional], [layout]);
  // 화면에 보이는 문서 전부(필수·선택·광고성). 맨 위 "전체 동의"가 이것과 만 14세 확인을 한 번에 켠다.
  const visibleDocuments = useMemo(() => [...ordered, ...layout.marketing], [ordered, layout]);
  const everythingGranted =
    ageConfirmed &&
    visibleDocuments.length > 0 &&
    visibleDocuments.every((d) => choices[d.id] === 'granted');
  const marketingAllGranted =
    layout.marketing.length > 0 && layout.marketing.every((d) => choices[d.id] === 'granted');
  const choiceMap = useMemo(() => new Map(Object.entries(choices)), [choices]);
  const canProceed = canSubmitConsentDecisions(documents, choiceMap) && ageConfirmed;
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

  /**
   * 전체 동의 — 만 14세 확인과 화면에 보이는 문서(선택 포함)를 한 번에 켜거나 끈다. 기본은 꺼져 있고,
   * 켠 뒤에도 선택 항목은 줄마다 다시 끌 수 있다. 가입 화면에서 뺀 문서(기능 안에서 묻는 것)는 건드리지 않는다.
   */
  const toggleEverything = () => {
    if (busy) return;
    setAgeConfirmed(!everythingGranted);
    setChoices((current) => {
      const next = { ...current };
      for (const d of visibleDocuments) {
        if (everythingGranted) delete next[d.id];
        else next[d.id] = 'granted';
      }
      return next;
    });
  };

  const toggleMarketing = () => {
    if (busy) return;
    setChoices((current) => toggleConsentGroup(layout.marketing, current));
  };

  const proceed = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await submitSignup(choiceMap);
      // 광고성 정보 수신에 동의했으면 처리 결과를 알린다(정보통신망법 제50조 제7항). 가입이 끝나면 이 화면이
      // 내려가므로 앱 전체 자리로 보내 다음 화면 위에 S5.13 팝업으로 띄운다.
      const decisions = entryMarketingDecisions(documents, choiceMap);
      const notice = created && shouldNoticeEntryDecisions(decisions)
        ? marketingDecisionNotice(decisions, new Date())
        : null;
      if (notice) showMarketingNotice(notice);
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
      {/* 나가면 아무것도 남지 않는다. 계정도, 제공자가 준 이름도. */}
      <BackTitleHeader
        title={t('consent.headerTitle')}
        back={<BareBackButton label={t('consent.exit')} phLabel="consent_exit" disabled={busy} onPress={() => cancelSignup()} />}
      />

      <ScrollView contentContainerStyle={styles.list}>
        <Text style={styles.title}>{t('consent.heading')}</Text>
        <Text style={styles.hint}>{t(canProceed ? 'consent.headingReady' : 'consent.headingHint')}</Text>
        <Pressable
          style={styles.allRow}
          onPress={toggleEverything}
          disabled={busy}
          accessibilityRole="checkbox"
          accessibilityHint={t('consent.allAgreeHint')}
          accessibilityState={{ checked: everythingGranted }}>
          <Feather name="check-circle" size={24} color={everythingGranted ? palette.blue : palette.checkOff} />
          <Text style={styles.allLabel}>{t('consent.allAgree')}</Text>
        </Pressable>
        <ConsentRow
          label={`${t('consent.requiredTag')} ${t('consent.ageConfirm')}`}
          checked={ageConfirmed}
          locked={busy}
          onToggle={() => setAgeConfirmed((current) => !current)}
        />
        {ordered.map(renderRow)}
        {layout.marketing.length > 0 && (
          <View style={styles.marketing}>
            <ConsentRow
              compact
              label={`${t('consent.optionalTag')} ${t('consent.marketingGroup')}`}
              checked={marketingAllGranted}
              locked={busy}
              onToggle={toggleMarketing}
              arrow={{
                icon: expanded.marketing ? 'chevron-down' : 'chevron-right',
                onPress: () => setExpanded((current) => ({ ...current, marketing: !current.marketing })),
                accessibilityLabel: expanded.marketing ? t('common.fold') : t('common.view'),
              }}>
              <View style={styles.subRow}>
                {layout.marketing.map((document) => {
                  const on = choices[document.id] === 'granted';
                  return (
                    <Pressable
                      key={document.id}
                      style={styles.subItem}
                      onPress={() => toggleDocument(document)}
                      disabled={busy}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on, disabled: busy }}>
                      <Feather name="check" size={14} color={on ? palette.blue : palette.checkOff} />
                      <Text style={styles.subLabel}>
                        {t(document.type === 'marketing_push' ? 'consent.marketingPush' : 'consent.marketingEmail')}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {expanded.marketing && (
                <View style={styles.docBody}>
                  {layout.marketing.map((document) => (
                    <Markdown key={document.id} source={document.body} />
                  ))}
                </View>
              )}
            </ConsentRow>
          </View>
        )}
      </ScrollView>

      <CtaBar safeBottom={false} style={styles.footer}>
        {error && <Text style={styles.error}>{error}</Text>}
        <PrimaryButton label={t('consent.cta')} onPress={() => void proceed()} disabled={!canProceed} loading={busy} />
      </CtaBar>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  // pen 01 약관 동의 「Body」 — 안쪽 [13,20,0,20]. 동의 행(높이 55)은 사이 간격 없이 붙인다.
  list: { paddingHorizontal: 20, paddingTop: 13, paddingBottom: 24 },
  title: { fontSize: 20, fontWeight: '800', color: palette.text },
  // 누를 것 안내 — 제목 아래 6, 14/700 파랑.
  hint: { paddingTop: 6, fontSize: 14, fontWeight: '700', lineHeight: 21, color: palette.blueDeep },
  // 전체 동의 — 위 12 · 아래 6 띄운 높이 48, 안쪽 14, 모서리 16, #EAF3FE.
  allRow: {
    height: 48,
    marginTop: 12,
    marginBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: palette.blueSoft,
    borderRadius: 16,
    paddingHorizontal: 14,
  },
  allLabel: { flex: 1, fontSize: 18, fontWeight: '800', color: palette.text },
  docBody: { paddingHorizontal: 14, paddingBottom: 12 },
  // 광고성 정보 — 위 20 띄우고, 이메일·앱 푸시는 체크 글자 밑(41)에서 시작해 18 간격.
  marketing: { paddingTop: 20 },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 18, paddingTop: 10, paddingLeft: 41, paddingBottom: 10 },
  subItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  subLabel: { fontSize: 15, fontWeight: '600', color: palette.textStrong },
  footer: { paddingTop: 8, paddingHorizontal: 20, paddingBottom: 11 },
  error: { color: palette.danger, textAlign: 'center', paddingHorizontal: 4 },
});
