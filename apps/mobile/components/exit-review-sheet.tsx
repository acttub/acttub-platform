import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import {
  CONTACT_MAX_LENGTH,
  EXIT_REVIEW_MAX_LENGTH,
  exitReviewCopy,
  sendableOneLiner,
  type ExitReviewTrigger,
} from '@/lib/exit-review-policy';
import { translate as t } from '@/lib/i18n';

/**
 * 나갈 때·마칠 때 한 번 뜨는 한줄평 바텀시트(SOMA-433). 디자인은 「RN앱 반영.pen」
 * "A7 이탈 설문 · RN 앱". 딤을 눌러도 닫히지 않는다 — 건너뛰기는 버튼으로만.
 * 아무 말 없이 사라지면 "한 번만" 약속을 쓴 셈이 되기 때문이다.
 */
export function ExitReviewSheet({
  visible,
  trigger,
  sending,
  onSubmit,
  onSkip,
}: {
  visible: boolean;
  trigger: ExitReviewTrigger;
  sending: boolean;
  onSubmit: (text: string, contact: { email: string; phone: string }) => void;
  onSkip: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const copy = exitReviewCopy(trigger);
  const canSubmit = sendableOneLiner(text) !== null && !sending;

  return (
    <Modal transparent statusBarTranslucent visible={visible} animationType="slide" onRequestClose={onSkip}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.sheet, { paddingBottom: 18 + insets.bottom }]}>
          <View style={styles.handle} />
          <Text style={styles.title}>{copy.title}</Text>
          <Text style={styles.subtitle}>{copy.subtitle}</Text>

          <View style={styles.inputBox}>
            <TextInput
              style={styles.input}
              value={text}
              onChangeText={setText}
              placeholder={copy.placeholder}
              placeholderTextColor={palette.textFaint}
              multiline
              maxLength={EXIT_REVIEW_MAX_LENGTH}
              editable={!sending}
              textAlignVertical="top"
              accessibilityLabel={t('exitReview.a11yInput')}
            />
            <Text style={styles.counter}>
              {text.length} / {EXIT_REVIEW_MAX_LENGTH}
            </Text>
          </View>

          {/* 인터뷰 연락처 — 선택. 비워도 한줄평 전송에는 영향이 없다(SOMA-433). */}
          <Text style={styles.contactHint}>{copy.contactHint}</Text>
          <View style={styles.contactRow}>
            <TextInput
              style={styles.contactInput}
              value={email}
              onChangeText={setEmail}
              placeholder={copy.contactEmailPlaceholder}
              placeholderTextColor={palette.textFaint}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={CONTACT_MAX_LENGTH}
              editable={!sending}
              accessibilityLabel={t('exitReview.a11yEmail')}
            />
            <TextInput
              style={styles.contactInput}
              value={phone}
              onChangeText={setPhone}
              placeholder={copy.contactPhonePlaceholder}
              placeholderTextColor={palette.textFaint}
              keyboardType="phone-pad"
              maxLength={CONTACT_MAX_LENGTH}
              editable={!sending}
              accessibilityLabel={t('exitReview.a11yPhone')}
            />
          </View>

          <Pressable
            style={[styles.submit, !canSubmit && styles.submitOff]}
            disabled={!canSubmit}
            onPress={() => onSubmit(text, { email, phone })}
            accessibilityRole="button">
            <Text style={styles.submitText}>{sending ? t('exitReview.sending') : copy.submit}</Text>
          </Pressable>
          <Pressable style={styles.skip} onPress={onSkip} disabled={sending} accessibilityRole="button" hitSlop={8}>
            <Text style={styles.skipText}>{copy.skip}</Text>
          </Pressable>
          <Text style={styles.notice}>{copy.notice}</Text>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#0F141E73', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: palette.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 8,
    paddingHorizontal: 20,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 9999,
    backgroundColor: palette.border,
    marginVertical: 10,
  },
  title: { fontSize: 21, fontWeight: '900', color: palette.text, letterSpacing: -0.5, marginTop: 6 },
  subtitle: { fontSize: 14, fontWeight: '600', color: palette.textMuted, lineHeight: 21, marginTop: 6 },
  inputBox: {
    marginTop: 20,
    backgroundColor: palette.bgSubtle,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    minHeight: 104,
  },
  input: { fontSize: 15, fontWeight: '600', color: palette.text, lineHeight: 22, minHeight: 56, padding: 0 },
  counter: { alignSelf: 'flex-end', fontSize: 12, fontWeight: '600', color: palette.checkOff, marginTop: 6 },
  contactHint: { fontSize: 12.5, fontWeight: '700', color: palette.textMuted, marginTop: 14 },
  contactRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  contactInput: {
    flex: 1,
    height: 44,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.bgSubtle,
    borderRadius: 12,
    paddingHorizontal: 12,
    fontSize: 13.5,
    fontWeight: '600',
    color: palette.text,
  },
  submit: {
    height: 54,
    borderRadius: 14,
    backgroundColor: palette.blue,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
  },
  submitOff: { backgroundColor: palette.blueLine },
  submitText: { color: palette.bg, fontSize: 16, fontWeight: '800' },
  skip: { height: 44, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  skipText: { fontSize: 14, fontWeight: '700', color: palette.textFaint },
  notice: { fontSize: 12, fontWeight: '600', color: palette.textFaint, textAlign: 'center', marginTop: 2 },
});
