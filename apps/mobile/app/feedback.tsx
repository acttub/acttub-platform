import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui/buttons';
import { CtaBar } from '@/components/ui/cta-bar';
import { InlineErrorLine } from '@/components/ui/inline-error';
import { NavBackButton, NavHeader } from '@/components/ui/nav-header';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { useReadableInput } from '@/hooks/use-readable-input';
import { logEvent } from '@/lib/analytics';
import { api, type SupportCategory } from '@/lib/api';
import { INSTAGRAM_HANDLE, KAKAO_OPEN_CHAT_URL, SUPPORT_EMAIL } from '@/lib/contact-channels';
import { useAuth } from '@/lib/auth';
import { translate as t } from '@/lib/i18n';

/** 서버 SupportInquiryRules 와 같은 한도(본문 10~3000자, 메일 형식). */
export const FEEDBACK_MIN = 10;
export const FEEDBACK_MAX = 3000;
/** 메일 모양인가 — 공백 없이 @ 하나, @ 뒤에 점. 되돌아가며 맞추는 정규식은 쓰지 않는다(SonarCloud S8786). */
function looksLikeEmail(value: string): boolean {
  if (value.length > 254 || /\s/.test(value)) return false;
  const at = value.indexOf('@');
  if (at <= 0 || at !== value.lastIndexOf('@')) return false;
  const dot = value.lastIndexOf('.');
  return dot > at + 1 && dot < value.length - 1;
}
/**
 * 메일 칸은 두지 않는다(11/1 사용자 결정) — 로그인한 계정으로 받으므로 서버가 계정(user_id)을 같이 남긴다. 서버가 메일을 필수로
 * 받으므로 계정 메일을 그대로 싣고, 계정에 메일이 없으면(카카오 미동의 등) 답장 없는 자리표시 주소를 싣는다.
 */
const NO_REPLY_EMAIL = 'no-reply@acttub.com';
export function feedbackEmail(account: string | null | undefined): string {
  const value = (account ?? '').trim();
  return looksLikeEmail(value) ? value : NO_REPLY_EMAIL;
}

/**
 * 문의·신고 분류(11/3 사용자 「문의·신고도 메일 말고 앱 자체 창구로」). 서버 분류 값 그대로 보낸다.
 * 신고가 맨 앞 — 앱스토어 1.2(부적절 활동 신고 창구)를 앱 안에서 바로 쓰게.
 */
export const SUPPORT_KINDS: { category: SupportCategory; label: string }[] = [
  { category: 'report', label: 'support.kindReport' },
  { category: 'usage', label: 'support.kindUsage' },
  { category: 'bug', label: 'support.kindBug' },
  { category: 'billing', label: 'support.kindBilling' },
  { category: 'account', label: 'support.kindAccount' },
  { category: 'other', label: 'support.kindOther' },
];

/**
 * 앱 안 의견 보내기(SOMA-953) — 웹 문의 접수 API 에 category 'feedback' 으로 보낸다.
 * `?kind=support` 로 열면 문의·신고 창구다 — 분류를 고르고 같은 API 에 그 분류로 보낸다(11/3, 메일 대신).
 * 팝업 없이 한 화면 안에서 입력 → 보내는 중 → 완료/오류까지 끝낸다.
 */
export default function FeedbackScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const support = useLocalSearchParams<{ kind?: string }>().kind === 'support';
  const k = (key: string) => t(`${support ? 'support' : 'feedback'}.${key}`);
  const [category, setCategory] = useState<SupportCategory | null>(null);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 입력 허용 글자 규칙(#1106): 다른 입력칸과 같은 strict 규칙을 쓴다.
  const bodyInput = useReadableInput(setBody, 'strict');

  const length = Array.from(body.trim()).length;
  const bodyOk = length >= FEEDBACK_MIN && length <= FEEDBACK_MAX;
  const canSend = bodyOk && !sending && (!support || category !== null);

  const leave = () => (router.canGoBack() ? router.back() : router.replace('/settings'));

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      await api.sendFeedback({ email: feedbackEmail(user?.email), body: body.trim(), category: support ? (category ?? 'other') : 'feedback' });
      logEvent(support ? 'support_sent' : 'feedback_sent', support ? { category: category ?? 'other' } : undefined);
      setDone(true);
    } catch (err) {
      const status = (err as { status?: number } | null)?.status;
      setError(
        status === 429 ? t('feedback.failBusy') : status === 422 || status === 400 ? t('feedback.failInvalid') : t('feedback.failRetry'),
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <NavHeader title={k('title')} left={<NavBackButton onPress={leave} disabled={sending} />} />
      {done ? (
        <View style={styles.doneWrap}>
          <Text style={styles.doneTitle}>{k('doneTitle')}</Text>
          <Text style={styles.doneBody}>{k('doneBody')}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.intro}>{k('intro')}</Text>
          {support && (
            <View style={styles.field}>
              <Text style={styles.label}>{t('support.kindLabel')}</Text>
              <View style={styles.chips} accessibilityRole="radiogroup">
                {SUPPORT_KINDS.map((kind) => {
                  const on = category === kind.category;
                  return (
                    <Pressable
                      key={kind.category}
                      style={[styles.chip, on && styles.chipOn]}
                      onPress={() => setCategory(kind.category)}
                      disabled={sending}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}>
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>{t(kind.label)}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}
          <View style={styles.field}>
            <Text style={styles.label}>{k('bodyLabel')}</Text>
            <TextInput
              value={body}
              onChangeText={bodyInput.onChangeText}
              placeholder={k('bodyPlaceholder')}
              placeholderTextColor={palette.textMeta}
              accessibilityLabel={k('bodyLabel')}
              multiline
              textAlignVertical="top"
              maxLength={FEEDBACK_MAX}
              editable={!sending}
              style={styles.area}
            />
            <Text style={styles.count}>{t('feedback.count', { count: length, max: FEEDBACK_MAX })}</Text>
            {bodyInput.hint ? <InlineErrorLine message={bodyInput.hint} /> : null}
          </View>
          {error ? <InlineErrorLine message={error} /> : null}
          {/* 앱스토어 1.2 「연락처 공개」 — 버튼은 앱 안 창구지만 메일 주소는 글로 남긴다. */}
          {support && (
            // 앱 밖 창구도 같이 알린다 — 카카오톡 오픈채팅은 누르면 열리고, 인스타·메일은 글로 적는다(11/3).
            <View style={styles.contacts}>
              <Text style={styles.label}>{t('support.otherWays')}</Text>
              {!!KAKAO_OPEN_CHAT_URL && (
                <Pressable onPress={() => void Linking.openURL(KAKAO_OPEN_CHAT_URL).catch(() => undefined)} accessibilityRole="link" hitSlop={6}>
                  <Text style={styles.contactLink}>{t('support.openChat')}</Text>
                </Pressable>
              )}
              <Text style={styles.contactText}>{t('support.instagram', { handle: INSTAGRAM_HANDLE })}</Text>
              <Text style={styles.contactText}>{t('support.email', { email: SUPPORT_EMAIL })}</Text>
            </View>
          )}
        </ScrollView>
      )}
      <CtaBar>
        {done ? (
          <PrimaryButton label={t('feedback.back')} onPress={leave} />
        ) : (
          <PrimaryButton label={sending ? t('feedback.sending') : t('feedback.send')} onPress={() => void send()} disabled={!canSend} />
        )}
      </CtaBar>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  body: { paddingHorizontal: space.gutter, paddingTop: space[2], paddingBottom: space[6], gap: space[4] },
  intro: { ...type.body1, color: palette.textSub },
  field: { gap: space[2] },
  label: { ...type.body2Bold, color: palette.textSub },
  area: {
    minHeight: 160,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.bg,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    ...type.body1,
    lineHeight: undefined,
    color: palette.text,
  },
  count: { ...type.caption, color: palette.textMeta, textAlign: 'right' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  contacts: { gap: space[1.5], paddingTop: space[2] },
  contactLink: { ...type.body2Bold, color: palette.blueDeep },
  contactText: { ...type.body2, color: palette.textSub },
  chip: { borderRadius: radius.full, borderWidth: 1, borderColor: palette.border, paddingHorizontal: space[4], paddingVertical: space[2] },
  chipOn: { borderColor: palette.blue, backgroundColor: palette.blueSoft },
  chipText: { ...type.body2, color: palette.textSub },
  chipTextOn: { ...type.body2Bold, color: palette.blueDeep },
  doneWrap: { flex: 1, paddingHorizontal: space.gutter, paddingTop: space[8], gap: space[2] },
  doneTitle: { ...type.title2, color: palette.text },
  doneBody: { ...type.body1, color: palette.textSub },
});
