import Feather from '@expo/vector-icons/Feather';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
import { KeyboardAwareScroll } from '@/components/keyboard-aware-scroll';
import { palette } from '@/constants/palette';
import { logEvent } from '@/lib/analytics';
import { translate as t } from '@/lib/i18n';

/**
 * A16.2 새 대사 등록 — 3단계 위저드. 1/3 대사(pen), 2/3 작품·인물, 3/3 확인(뒤 둘은 pen에
 * 없어 1/3 톤을 이어 추론했다). 등록 API가 없어 마지막은 안내만 하고 돌아간다.
 */
export default function LineNewScreen() {
  const router = useRouter();
  const { alert, dialog } = useAppDialog();
  const params = useLocalSearchParams<{ line?: string }>();
  const [step, setStep] = useState(0);
  const [line, setLine] = useState(params.line ?? '');
  const [work, setWork] = useState('');
  const [role, setRole] = useState('');

  const canNext = step === 0 ? line.trim().length > 0 : step === 1 ? work.trim().length > 0 : true;

  const next = async () => {
    if (step < 2) {
      setStep(step + 1);
      return;
    }
    logEvent('line_register', { line: line.trim().slice(0, 40), work: work.trim(), role: role.trim() || 'none' });
    await alert({ title: t('lineNew.doneTitle'), message: t('lineNew.doneMessage'), confirmLabel: t('common.confirm') });
    router.back();
  };
  const back = () => (step > 0 ? setStep(step - 1) : router.back());

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable onPress={back} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('common.back')}>
          <Feather name={step === 0 ? 'x' : 'chevron-left'} size={26} color={palette.text} />
        </Pressable>
        <View style={styles.dots}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={[styles.dot, i === step && styles.dotOn]} />
          ))}
        </View>
        <Text style={styles.stepText}>{t('lineNew.step', { step: step + 1 })}</Text>
      </View>

      <KeyboardAwareScroll contentContainerStyle={styles.content}>
        {step === 0 && (
          <>
            <Text style={styles.title}>{t('lineNew.title1')}</Text>
            <Text style={styles.sub}>{t('lineNew.sub1')}</Text>
            <TextInput
              style={styles.lineInput}
              placeholder={t('lineNew.linePh')}
              placeholderTextColor={palette.textFaint}
              value={line}
              onChangeText={setLine}
              multiline
              autoFocus
              textAlignVertical="top"
            />
            <View style={styles.hintRow}>
              <Feather name="zap" size={13} color={palette.blue} />
              <Text style={styles.hint}>{t('lineNew.hint1')}</Text>
            </View>
          </>
        )}
        {step === 1 && (
          <>
            <Text style={styles.title}>{t('lineNew.title2')}</Text>
            <Text style={styles.sub}>{t('lineNew.sub2')}</Text>
            <Text style={styles.label}>{t('lineNew.workLabel')}</Text>
            <TextInput
              style={styles.input}
              placeholder={t('lineNew.workPh')}
              placeholderTextColor={palette.textFaint}
              value={work}
              onChangeText={setWork}
              autoFocus
            />
            <Text style={styles.label}>{t('lineNew.roleLabel')}</Text>
            <TextInput
              style={styles.input}
              placeholder={t('lineNew.rolePh')}
              placeholderTextColor={palette.textFaint}
              value={role}
              onChangeText={setRole}
            />
          </>
        )}
        {step === 2 && (
          <>
            <Text style={styles.title}>{t('lineNew.title3')}</Text>
            <Text style={styles.sub}>{t('lineNew.sub3')}</Text>
            <View style={styles.previewCard}>
              <Text style={styles.previewLine}>“{line.trim()}”</Text>
              <Text style={styles.previewWork}>
                {work.trim()}
                {role.trim() ? ` · ${role.trim()}` : ''}
              </Text>
            </View>
          </>
        )}
      </KeyboardAwareScroll>

      <Pressable
        style={[styles.cta, !canNext && styles.ctaDisabled]}
        onPress={() => void next()}
        disabled={!canNext}
        accessibilityRole="button">
        <Text style={styles.ctaText}>{t(step === 2 ? 'lineNew.submit' : 'lineNew.next')}</Text>
        {step < 2 && <Feather name="arrow-right" size={18} color="#FFFFFF" />}
      </Pressable>
      {dialog}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bgSubtle },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  dots: { flex: 1, flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 14, height: 4, borderRadius: 2, backgroundColor: palette.border },
  dotOn: { width: 22, backgroundColor: palette.blue },
  stepText: { fontSize: 12.5, fontWeight: '700', color: palette.textFaint, width: 40, textAlign: 'right' },
  content: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 72, gap: 14 },
  title: { fontSize: 28, fontWeight: '800', color: palette.text, lineHeight: 38 },
  sub: { fontSize: 14, color: palette.textDim, lineHeight: 21, marginBottom: 24 },
  lineInput: {
    minHeight: 120,
    borderWidth: 1.5,
    borderColor: palette.blue,
    borderRadius: 14,
    padding: 16,
    fontSize: 17,
    fontWeight: '600',
    color: palette.text,
    backgroundColor: palette.card,
  },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  hint: { fontSize: 12.5, color: palette.textFaint },
  label: { fontSize: 13, fontWeight: '800', color: palette.textMuted, marginTop: 6 },
  input: {
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 16,
    fontSize: 15,
    fontWeight: '600',
    color: palette.text,
  },
  previewCard: { backgroundColor: palette.navy, borderRadius: 18, padding: 20, gap: 8 },
  previewLine: { fontSize: 18, fontWeight: '800', color: '#FFFFFF', lineHeight: 26 },
  previewWork: { fontSize: 13, fontWeight: '600', color: '#9FB0C9' },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    margin: 20,
    backgroundColor: palette.blue,
    borderRadius: 16,
    paddingVertical: 17,
  },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { fontSize: 16, fontWeight: '800', color: '#FFFFFF' },
});
