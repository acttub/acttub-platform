import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';
import {
  markFirstUploadGuideSeen,
  shouldShowFirstUploadGuide,
} from '@/lib/first-upload-guide-state';
import { MAX_VIDEO_DURATION_MS } from '@/lib/upload-input';
import { translate as t } from '@/lib/i18n';

const MAX_VIDEO_DURATION_MINUTES = MAX_VIDEO_DURATION_MS / 60_000;

const STEPS = [
  {
    emoji: '🎬',
    title: t('firstGuide.step1Title'),
    body: t('firstGuide.step1Body', { min: MAX_VIDEO_DURATION_MINUTES }),
  },
  { emoji: '✍️', title: t('firstGuide.step2Title'), body: t('firstGuide.step2Body') },
  { emoji: '▶️', title: t('firstGuide.step3Title'), body: t('firstGuide.step3Body') },
  { emoji: '💬', title: t('firstGuide.step4Title'), body: t('firstGuide.step4Body') },
];

export function FirstUploadGuide({ ownerId }: { ownerId: string }) {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    let active = true;
    void shouldShowFirstUploadGuide(AsyncStorage, ownerId).then((shouldShow) => {
      if (active) setVisible(shouldShow);
    });
    return () => {
      active = false;
    };
  }, [ownerId]);

  const close = () => {
    setVisible(false);
    void markFirstUploadGuideSeen(AsyncStorage, ownerId);
  };

  const next = () => {
    if (step >= STEPS.length - 1) close();
    else setStep((current) => current + 1);
  };

  if (!visible) return null;

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <Modal
      transparent
      visible
      animationType="fade"
      onRequestClose={close}
      statusBarTranslucent
      accessibilityRole="summary"
      accessibilityLabel={t('firstGuide.a11y')}
      accessibilityViewIsModal>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.counter}>
            {step + 1} / {STEPS.length}
          </Text>
          <Text style={styles.emoji}>{current.emoji}</Text>
          <Text style={styles.title}>{current.title}</Text>
          <Text style={styles.body}>{current.body}</Text>

          <View style={styles.dots}>
            {STEPS.map((_, index) => (
              <View
                key={index}
                style={[styles.dot, index === step && styles.dotOn]}
              />
            ))}
          </View>

          <View style={styles.actions}>
            <Pressable
              style={styles.skip}
              onPress={close}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('firstGuide.skipA11y')}>
              <Text style={styles.skipText}>{t('firstGuide.skip')}</Text>
            </Pressable>
            <Pressable
              style={styles.next}
              onPress={next}
              accessibilityRole="button"
              accessibilityLabel={isLast ? t('firstGuide.closeA11y') : t('firstGuide.nextA11y')}>
              <Text style={styles.nextText}>{isLast ? t('firstGuide.start') : t('firstGuide.next')}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,21,37,0.55)',
    justifyContent: 'flex-end',
    padding: 20,
    paddingBottom: 36,
  },
  card: {
    backgroundColor: palette.card,
    borderRadius: 24,
    padding: 24,
  },
  counter: { fontSize: 12, fontWeight: '800', color: palette.blue, marginBottom: 12 },
  emoji: { fontSize: 34, marginBottom: 10 },
  title: {
    fontSize: 20,
    fontWeight: '900',
    color: palette.text,
    letterSpacing: -0.4,
    marginBottom: 8,
  },
  body: { fontSize: 15, lineHeight: 23, color: palette.textDim },
  dots: { flexDirection: 'row', gap: 6, marginTop: 20 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: palette.border },
  dotOn: { width: 18, backgroundColor: palette.blue },
  actions: { flexDirection: 'row', alignItems: 'center', marginTop: 22 },
  skip: { paddingVertical: 10, paddingRight: 16 },
  skipText: { fontSize: 15, fontWeight: '700', color: palette.textFaint },
  next: {
    marginLeft: 'auto',
    backgroundColor: palette.blue,
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 28,
  },
  nextText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
});
