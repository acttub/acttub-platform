import Feather from '@expo/vector-icons/Feather';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { palette } from '@/constants/palette';
import { logEvent } from '@/lib/analytics';
import { useAuth } from '@/lib/auth';
import { oneLinerPayload, submitOneLiner } from '@/lib/exit-review';
import { translate as t } from '@/lib/i18n';

/**
 * 연습 노트 맨 아래 미니 평가 — 👍/👎 하나 누르면 한 줄 입력칸이 펼쳐진다(선택).
 * 세션 맥락이 붙은 피드백이라 제일 쓸모 있다. 같은 구글 시트에 screen='report_inline',
 * text 앞에 👍/👎 를 붙여 보낸다(시트 열 구조를 안 바꾸려고 별도 필드 없이).
 */
export function ReportRating({ sessionId }: { sessionId: string | null | undefined }) {
  const { user } = useAuth();
  const [rating, setRating] = useState<'good' | 'bad' | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const send = async () => {
    if (!rating || sending) return;
    const mark = rating === 'good' ? '👍' : '👎';
    const payload = oneLinerPayload({
      text: `${mark} ${text.trim()}`.trim(),
      screen: 'report_inline',
      sessionId,
      userId: user?.id,
    });
    if (!payload) return;
    setSending(true);
    await submitOneLiner(payload);
    logEvent('report_rating_submit', { rating, length: text.trim().length });
    setSending(false);
    setSent(true);
  };

  if (sent) {
    return (
      <View style={styles.box}>
        <Text style={styles.thanks}>{t('report.rateThanks')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.box}>
      <Text style={styles.title}>{t('report.rateTitle')}</Text>
      <View style={styles.row}>
        {(
          [
            ['good', 'thumbs-up', 'report.rateGood'],
            ['bad', 'thumbs-down', 'report.rateBad'],
          ] as const
        ).map(([key, icon, label]) => (
          <Pressable
            key={key}
            style={[styles.chip, rating === key && styles.chipOn]}
            onPress={() => setRating(key)}
            accessibilityRole="button"
            accessibilityState={{ selected: rating === key }}>
            <Feather name={icon} size={15} color={rating === key ? palette.blueDeep : palette.textDim} />
            <Text style={[styles.chipText, rating === key && styles.chipTextOn]}>{t(label)}</Text>
          </Pressable>
        ))}
      </View>
      {rating && (
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder={t('report.ratePh')}
            placeholderTextColor={palette.textFaint}
            maxLength={100}
            editable={!sending}
          />
          <Pressable style={[styles.send, sending && styles.sendOff]} onPress={() => void send()} disabled={sending} accessibilityRole="button">
            <Text style={styles.sendText}>{t('report.rateSend')}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: palette.bgSubtle, borderRadius: 16, padding: 16, gap: 10 },
  title: { fontSize: 14, fontWeight: '800', color: palette.text },
  row: { flexDirection: 'row', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.card,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  chipOn: { backgroundColor: palette.blueSoft, borderColor: palette.blue },
  chipText: { fontSize: 13.5, fontWeight: '700', color: palette.textDim },
  chipTextOn: { color: palette.blueDeep },
  inputRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: {
    flex: 1,
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: palette.text,
  },
  send: { backgroundColor: palette.blue, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 11 },
  sendOff: { opacity: 0.5 },
  sendText: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },
  thanks: { fontSize: 14, fontWeight: '700', color: palette.blueDeep },
});
