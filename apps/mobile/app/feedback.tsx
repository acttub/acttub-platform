import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui/buttons';
import { CtaBar } from '@/components/ui/cta-bar';
import { InlineErrorLine } from '@/components/ui/inline-error';
import { NavBackButton, NavHeader } from '@/components/ui/nav-header';
import { TextField } from '@/components/ui/text-field';
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
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * 앱 안 의견 보내기(SOMA-953) — 웹 문의 접수 API 에 category 'feedback' 으로 보낸다.
 * 팝업 없이 한 화면 안에서 입력 → 보내는 중 → 완료/오류까지 끝낸다.
 */
export default function FeedbackScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [body, setBody] = useState('');
  const [email, setEmail] = useState(user?.email ?? '');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 입력 허용 글자 규칙(#1106): 다른 입력칸과 같은 strict 규칙을 쓴다.
  const bodyInput = useReadableInput(setBody, 'strict');

  const length = Array.from(body.trim()).length;
  const bodyOk = length >= FEEDBACK_MIN && length <= FEEDBACK_MAX;
  const emailOk = EMAIL_PATTERN.test(email.trim()) && email.trim().length <= 254;
  const canSend = bodyOk && emailOk && !sending;

  const leave = () => (router.canGoBack() ? router.back() : router.replace('/settings'));

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      await api.sendFeedback({ email: email.trim(), body: body.trim() });
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
          <TextField
            label={t('feedback.emailLabel')}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!sending}
            error={email.trim().length > 0 && !emailOk ? t('feedback.emailInvalid') : null}
          />
          <Text style={styles.help}>{t('feedback.emailHelp')}</Text>
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
  help: { ...type.caption, color: palette.textMeta, marginTop: -space[2] },
  doneWrap: { flex: 1, paddingHorizontal: space.gutter, paddingTop: space[8], gap: space[2] },
  doneTitle: { ...type.title2, color: palette.text },
  doneBody: { ...type.body1, color: palette.textSub },
});
