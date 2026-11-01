import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui/buttons';
import { CtaBar } from '@/components/ui/cta-bar';
import { InlineErrorLine } from '@/components/ui/inline-error';
import { NavBackButton, NavHeader } from '@/components/ui/nav-header';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { useReadableInput } from '@/hooks/use-readable-input';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
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
 * 앱 안 의견 보내기(SOMA-953) — 웹 문의 접수 API 에 category 'feedback' 으로 보낸다.
 * 팝업 없이 한 화면 안에서 입력 → 보내는 중 → 완료/오류까지 끝낸다.
 */
export default function FeedbackScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 입력 허용 글자 규칙(#1106): 다른 입력칸과 같은 strict 규칙을 쓴다.
  const bodyInput = useReadableInput(setBody, 'strict');

  const length = Array.from(body.trim()).length;
  const bodyOk = length >= FEEDBACK_MIN && length <= FEEDBACK_MAX;
  const canSend = bodyOk && !sending;

  const leave = () => (router.canGoBack() ? router.back() : router.replace('/settings'));

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      await api.sendFeedback({ email: feedbackEmail(user?.email), body: body.trim() });
      void logEvent('feedback_sent');
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
      <NavHeader title={t('feedback.title')} left={<NavBackButton onPress={leave} disabled={sending} />} />
      {done ? (
        <View style={styles.doneWrap}>
          <Text style={styles.doneTitle}>{t('feedback.doneTitle')}</Text>
          <Text style={styles.doneBody}>{t('feedback.doneBody')}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.intro}>{t('feedback.intro')}</Text>
          <View style={styles.field}>
            <Text style={styles.label}>{t('feedback.bodyLabel')}</Text>
            <TextInput
              value={body}
              onChangeText={bodyInput.onChangeText}
              placeholder={t('feedback.bodyPlaceholder')}
              placeholderTextColor={palette.textMeta}
              accessibilityLabel={t('feedback.bodyLabel')}
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
  doneWrap: { flex: 1, paddingHorizontal: space.gutter, paddingTop: space[8], gap: space[2] },
  doneTitle: { ...type.title2, color: palette.text },
  doneBody: { ...type.body1, color: palette.textSub },
});
