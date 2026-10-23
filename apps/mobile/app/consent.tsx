import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConsentRow } from '@/components/consent-row';
import { Markdown } from '@/components/markdown';
import { PrimaryButton } from '@/components/ui/buttons';
import { CtaBar } from '@/components/ui/cta-bar';
import { MASCOT, MASCOT_SIZE } from '@/components/ui/mascot';
import { BareBackButton } from '@/components/ui/nav-header';
import { palette } from '@/constants/palette';
import type { ConsentDocument } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  canSubmitConsentDecisions,
  signupFailureAction,
  signupScreenLayout,
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

/** 가입 동의 한 줄 — 화면에 보이는 줄 하나가 동의할 문서 0~2개와(만 14세 확인 포함 여부)를 묶는다. */
type ConsentLine = {
  key: string;
  required: boolean;
  label: string;
  documents: ConsentDocument[];
  /** 만 14세 확인을 이 줄이 함께 켠다(「만 14세 이상 · 이용약관」). */
  age?: boolean;
};

/** 문서 종류별 줄 제목(pen S4.1). 모르는 종류는 서버가 준 제목을 쓴다. */
const LINE_LABEL_KEYS: Record<string, string> = {
  terms: 'consent.rowTerms',
  privacy: 'consent.rowPrivacy',
  post_withdrawal_retention: 'consent.rowRetention',
  retention: 'consent.rowRetention',
};

/**
 * A0.1 가입 동의(pen S4.1 「동의 · 가입」) — 처음 온 신원만 본다. 이미 있는 계정의 새 판 동의는 홈 위 재동의 화면이 묻는다.
 *
 * 줄은 넷이다. 필수 「만 14세 이상 · 이용약관」「개인정보 처리 · AI 분석」, 선택 「탈퇴 후 영상·녹음 보관」「혜택·이벤트 소식 받기(광고성 정보,
 * 이메일·앱 푸시)」. 줄마다 동그라미 체크 · 필수/선택 표 · 꺾쇠가 있고 꺾쇠를 누르면 본문이 아래로 펼쳐진다. 아래에 「모두 동의하기」(선택 포함,
 * 기본 꺼짐)와 「동의하고 시작하기」가 있고, 필수를 다 고르기 전에는 버튼이 꺼져 있다.
 * 고품질 목소리·대본 나누기는 개인정보 동의 v9에 들어 있어 따로 보이지 않는다.
 * 제출이 통과하는 순간 계정이 생긴다(POST /v2/auth/signup, 모든 결정을 한 번에). 나가면 아무것도 남지 않는다.
 */
export default function ConsentScreen() {
  const { signup, submitSignup, reloadSignupDocuments, cancelSignup } = useAuth();
  const [choices, setChoices] = useState<Record<string, ConsentChoice>>({});
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const documents = useMemo<ConsentDocument[]>(() => signup?.documents ?? [], [signup?.documents]);
  const layout = useMemo(() => signupScreenLayout(documents), [documents]);
  const lines = useMemo<ConsentLine[]>(() => {
    const labelOf = (document: ConsentDocument) =>
      LINE_LABEL_KEYS[document.type] ? t(LINE_LABEL_KEYS[document.type]) : document.title;
    // 만 14세 확인은 이용약관 줄에 붙인다. 이용약관 문서가 없으면 확인만 하는 줄을 맨 위에 둔다.
    const termsDocument = layout.required.find((d) => d.type === 'terms');
    const result: ConsentLine[] = [];
    if (!termsDocument) {
      result.push({ key: 'age', required: true, label: t('consent.ageConfirm'), documents: [], age: true });
    }
    // 「개인정보 처리 · AI 분석」은 한 줄이다(pen S4.1). 서버의 AI 분석 문서는 개인정보 줄에 같이 묶어 한 번에 동의받는다.
    const privacyDocument = layout.required.find((d) => d.type === 'privacy');
    const mergedIntoPrivacy = (d: ConsentDocument) => privacyDocument != null && d.type === 'ai_analysis';
    for (const document of layout.required) {
      if (mergedIntoPrivacy(document)) continue;
      const extra = document === privacyDocument ? layout.required.filter(mergedIntoPrivacy) : [];
      result.push({
        key: document.id,
        required: true,
        label: labelOf(document),
        documents: [document, ...extra],
        age: document === termsDocument,
      });
    }
    for (const document of layout.optional) {
      result.push({ key: document.id, required: false, label: labelOf(document), documents: [document] });
    }
    if (layout.marketing.length > 0) {
      result.push({ key: 'marketing', required: false, label: t('consent.rowMarketing'), documents: layout.marketing });
    }
    return result;
  }, [layout]);
  const choiceMap = useMemo(() => new Map(Object.entries(choices)), [choices]);
  const canProceed = canSubmitConsentDecisions(documents, choiceMap) && ageConfirmed;
  const lineChecked = (line: ConsentLine) =>
    (!line.age || ageConfirmed) && line.documents.every((d) => choices[d.id] === 'granted');
  const everythingGranted = lines.length > 0 && lines.every(lineChecked);
  useEffect(() => {
    setChoices({});
    setError(null);
  }, [documents]);

  /** 줄을 누르면 켜고(그 줄의 문서와 만 14세 확인), 켜져 있으면 끈다. 선택 줄은 끄면 거절이다. */
  const toggleLine = (line: ConsentLine) => {
    if (busy) return;
    const turnOff = lineChecked(line);
    if (line.age) setAgeConfirmed(!turnOff);
    setChoices((current) => {
      const next = { ...current };
      for (const d of line.documents) {
        if (turnOff) delete next[d.id];
        else next[d.id] = 'granted';
      }
      return next;
    });
  };

  /**
   * 모두 동의하기 — 만 14세 확인과 화면에 보이는 문서(선택 포함)를 한 번에 켜거나 끈다. 기본은 꺼져 있고,
   * 켠 뒤에도 줄마다 다시 끌 수 있다. 가입 화면에서 뺀 문서(기능 안에서 묻는 것)는 건드리지 않는다.
   */
  const toggleEverything = () => {
    if (busy) return;
    const turnOff = everythingGranted;
    setAgeConfirmed(!turnOff);
    setChoices((current) => {
      const next = { ...current };
      for (const line of lines) {
        for (const d of line.documents) {
          if (turnOff) delete next[d.id];
          else next[d.id] = 'granted';
        }
      }
      return next;
    });
  };

  const proceed = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await submitSignup(choiceMap);
      // 광고성 정보 수신에 동의했으면 처리 결과를 알린다(정보통신망법 제50조 제7항). 가입이 끝나면 이 화면이
      // 내려가므로 앱 전체 자리로 보내 다음 화면 위에 S5.13 안내로 띄운다.
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

  const renderLine = (line: ConsentLine) => {
    const open = !!expanded[line.key];
    const hasBody = line.documents.length > 0;
    return (
      <ConsentRow
        key={line.key}
        label={line.label}
        tag={{ text: t(line.required ? 'consent.tagRequired' : 'consent.tagOptional'), required: line.required }}
        checked={lineChecked(line)}
        locked={busy}
        onToggle={() => toggleLine(line)}
        arrow={
          hasBody
            ? {
                icon: open ? 'chevron-down' : 'chevron-right',
                onPress: () => setExpanded((current) => ({ ...current, [line.key]: !current[line.key] })),
                accessibilityLabel: open ? t('common.fold') : t('common.view'),
              }
            : undefined
        }>
        {open && hasBody && (
          <View style={styles.docBody}>
            {line.documents.map((document) => (
              <Markdown key={document.id} source={document.body} />
            ))}
          </View>
        )}
      </ConsentRow>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <Stack.Screen options={{ headerShown: false }} />
      {/* 나가면 아무것도 남지 않는다. 계정도, 제공자가 준 이름도. */}
      <View style={styles.header}>
        <BareBackButton label={t('consent.exit')} phLabel="consent_exit" disabled={busy} onPress={() => cancelSignup()} />
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        <Image source={MASCOT.coach} style={MASCOT_SIZE.bubble} contentFit="contain" accessibilityIgnoresInvertColors />
        <Text style={styles.title} accessibilityRole="header">{t('consent.startHeading')}</Text>
        <Text style={styles.hint}>{t('consent.startHint')}</Text>
        <View style={styles.lines}>{lines.map(renderLine)}</View>
      </ScrollView>

      <CtaBar safeBottom={false} style={styles.footer}>
        {error && <Text style={styles.error}>{error}</Text>}
        <Pressable
          style={[styles.allRow, everythingGranted && styles.allRowOn]}
          onPress={toggleEverything}
          disabled={busy}
          accessibilityRole="checkbox"
          accessibilityHint={t('consent.allAgreeHint')}
          accessibilityState={{ checked: everythingGranted }}>
          <Feather name="check-circle" size={24} color={everythingGranted ? palette.blue : palette.checkOff} />
          <Text style={styles.allLabel}>{t('consent.allAgreeStart')}</Text>
        </Pressable>
        <PrimaryButton label={t('consent.ctaStart')} onPress={() => void proceed()} disabled={!canProceed} loading={busy} />
      </CtaBar>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  header: { height: 44, justifyContent: 'center', paddingHorizontal: 24 },
  // 좌우 여백 24 · 제목 26/800 줄높이 1.34 · 설명 15/400 줄높이 1.5(제목과 6~8 사이).
  list: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 16 },
  title: { marginTop: 8, fontSize: 26, fontWeight: '800', lineHeight: 35, color: palette.text },
  hint: { marginTop: 8, fontSize: 15, fontWeight: '400', lineHeight: 22, color: palette.textMuted },
  lines: { marginTop: 20 },
  docBody: { paddingHorizontal: 14, paddingBottom: 12 },
  footer: { paddingTop: 8, paddingHorizontal: 24, paddingBottom: 12, gap: 8 },
  // 모두 동의하기 — 높이 52, 모서리 16. 꺼짐 #F2F4F6 → 켜짐 #EAF3FE.
  allRow: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: palette.bgSoft,
    borderRadius: 16,
    paddingHorizontal: 18,
  },
  allRowOn: { backgroundColor: palette.blueSoft },
  allLabel: { flex: 1, fontSize: 17, fontWeight: '700', color: palette.text },
  error: { color: palette.danger, textAlign: 'center', paddingHorizontal: 4 },
});
