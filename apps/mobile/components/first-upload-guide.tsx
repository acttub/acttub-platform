import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';
import {
  markFirstUploadGuideSeen,
  shouldShowFirstUploadGuide,
} from '@/lib/first-upload-guide-state';
import { MAX_VIDEO_DURATION_MS } from '@/lib/upload-input';

const MAX_VIDEO_DURATION_MINUTES = MAX_VIDEO_DURATION_MS / 60_000;

const STEPS = [
  {
    emoji: '🎬',
    title: '영상 올리기',
    body: `갤러리에서 오늘 연습한 장면 영상을 올려요. mp4·mov, ${MAX_VIDEO_DURATION_MINUTES}분 이내면 돼요.`,
  },
  {
    emoji: '✍️',
    title: '장면 맥락 적기',
    body: '상황 · 인물 · 보여주고 싶었던 의도를 짧게 적어요. 이걸 근거로 질문이 만들어져요.',
  },
  {
    emoji: '▶️',
    title: '분석 시작',
    body: '영상과 맥락을 채우면 아래 “분석 시작” 버튼이 켜져요. 누르면 분석이 돌아가요.',
  },
  {
    emoji: '💬',
    title: '질문에 답하기',
    body: '분석이 끝나면 질문이 하나씩 도착해요. 정답은 없어요 — 떠오르는 대로 답하면, 쌓인 답이 마지막에 연습 노트로 정리돼요.',
  },
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
      accessibilityLabel="첫 영상 업로드 가이드"
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
              accessibilityLabel="첫 영상 업로드 가이드 건너뛰기">
              <Text style={styles.skipText}>건너뛰기</Text>
            </Pressable>
            <Pressable
              style={styles.next}
              onPress={next}
              accessibilityRole="button"
              accessibilityLabel={isLast ? '가이드 닫고 시작하기' : '가이드 다음 단계'}>
              <Text style={styles.nextText}>{isLast ? '시작하기' : '다음'}</Text>
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
