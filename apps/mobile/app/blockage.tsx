import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  BLOCKAGE_CHOICES,
  blockageDetailExamples,
  blockageDetailTitle,
  changeBlockageKind,
  changeBlockageSubBranch,
  chooseBlockageKind,
  chooseBlockageSubBranch,
  completeBlockageFlow,
  initialBlockageFlowState,
  subBranchChoices,
  updateBlockageDetail,
  type BlockageFlowState,
} from '@/lib/blockage';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { setPendingBlockage } from '@/lib/practice';
import { palette } from '@/constants/palette';

/**
 * 막히는 지점 고르기 — 장면을 적은 뒤, 분석을 시작하기 전 단계.
 *
 * 서버가 이 선택으로 코치를 가르므로(분석/표현) 건너뛸 수 없다. 웹과 같은 선택지·
 * 같은 순서를 쓴다 — 플랫폼마다 다른 값을 보내면 같은 배우가 기기에 따라 다른
 * 질문을 받는다.
 */
export default function BlockageScreen() {
  const router = useRouter();
  const keyboardHeight = useKeyboardHeight();
  const [state, setState] = useState<BlockageFlowState>(initialBlockageFlowState);
  const [examplesOpen, setExamplesOpen] = useState(false);

  const complete = () => {
    const selection = completeBlockageFlow(state);
    if (!selection) return;
    setPendingBlockage(selection);
    router.replace('/analyzing');
  };

  return (
    <SafeAreaView style={styles.safe} edges={keyboardHeight > 0 ? [] : ['bottom']}>
      <Stack.Screen options={{ title: '막히는 지점' }} />
      <View style={[styles.flex, { paddingBottom: keyboardHeight }]}>
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled">
          <Steps />

          {state.step === 'main' && (
            <Section
              title="지금 연기에서 어느 쪽이 더 막히나요?"
              description="고른 쪽에 맞춰 질문을 준비할게요. 하나만 골라 주세요.">
              {BLOCKAGE_CHOICES.map((choice) => (
                <Choice
                  key={choice.value}
                  title={choice.value}
                  description={choice.description}
                  onPress={() => setState((was) => chooseBlockageKind(was, choice.value))}
                />
              ))}
            </Section>
          )}

          {state.step === 'sub' && state.kind && (
            <>
              <BackChip
                label={`앞에서 고른 것 · ${state.kind}`}
                action="바꾸기"
                onPress={() => setState((was) => changeBlockageKind(was))}
              />
              <Section
                title={`${state.kind} 중에서도 어디가 가장 막히나요?`}
                description={`'${state.kind}'을 조금 더 좁혀 볼게요. 하나만 골라 주세요.`}>
                {subBranchChoices(state.kind).map((choice) => (
                  <Choice
                    key={choice.value}
                    title={choice.value}
                    description={choice.description}
                    onPress={() =>
                      setState((was) => chooseBlockageSubBranch(was, choice.value))
                    }
                  />
                ))}
              </Section>
            </>
          )}

          {state.step === 'detail' && state.kind && state.subBranch && (
            <>
              <BackChip
                label={`고른 것 · ${
                  state.kind === '그 외' ? state.kind : `${state.kind} · ${state.subBranch}`
                }`}
                action={state.kind === '그 외' ? '앞 선택 바꾸기' : `${state.subBranch} 바꾸기`}
                onPress={() => setState((was) => changeBlockageSubBranch(was))}
              />
              <Text style={styles.title}>{blockageDetailTitle(state.subBranch)}</Text>
              <Text style={styles.description}>
                어디에서 막히는지 적으면 질문이 더 정확해져요. 비워 두어도 괜찮아요.
              </Text>

              <Pressable
                style={styles.examplesHeader}
                onPress={() => setExamplesOpen((was) => !was)}
                accessibilityRole="button"
                accessibilityState={{ expanded: examplesOpen }}>
                <Text style={styles.examplesHeaderText}>예를 들면 —</Text>
                <Text style={styles.examplesHeaderText}>
                  {examplesOpen ? '접기' : '펼치기'}
                </Text>
              </Pressable>
              {examplesOpen && (
                <View style={styles.examples}>
                  {blockageDetailExamples(state.subBranch).map((example) => (
                    <Text key={example} style={styles.exampleLine}>
                      · {example}
                    </Text>
                  ))}
                </View>
              )}

              <TextInput
                style={styles.input}
                placeholder="막힌 순간을 편하게 적어 주세요"
                placeholderTextColor={palette.textDim}
                value={state.detail}
                onChangeText={(text) => setState((was) => updateBlockageDetail(was, text))}
                multiline
              />
              <View style={styles.footerRow}>
                <Text style={styles.counter}>{state.detail.length}자</Text>
                <Pressable style={styles.primary} onPress={complete}>
                  <Text style={styles.primaryText}>이대로 이어가기</Text>
                </Pressable>
              </View>
            </>
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function Steps() {
  return (
    <View style={styles.steps} accessibilityLabel="연습 진행 단계">
      <Text style={styles.stepDone}>✓ 영상 올리기</Text>
      <Text style={styles.stepDone}>✓ 장면 적기</Text>
      <Text style={styles.stepNow}>③ 질문 받기</Text>
    </View>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
      {children}
    </View>
  );
}

function Choice({
  title,
  description,
  onPress,
}: {
  title: string;
  description: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.choice} onPress={onPress} accessibilityRole="button">
      <Text style={styles.choiceTitle}>{title}</Text>
      <Text style={styles.choiceDescription}>{description}</Text>
    </Pressable>
  );
}

function BackChip({
  label,
  action,
  onPress,
}: {
  label: string;
  action: string;
  onPress: () => void;
}) {
  return (
    <View style={styles.backChip}>
      <Text style={styles.backChipLabel} numberOfLines={1}>
        {label}
      </Text>
      <Pressable onPress={onPress} accessibilityRole="button" hitSlop={8}>
        <Text style={styles.backChipAction}>{action}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  flex: { flex: 1 },
  container: { padding: 20, gap: 16 },
  steps: { flexDirection: 'row', gap: 8 },
  stepDone: {
    flex: 1,
    textAlign: 'center',
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    color: palette.textDim,
    fontSize: 12,
    fontWeight: '800',
  },
  stepNow: {
    flex: 1,
    textAlign: 'center',
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: palette.blue,
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  section: { gap: 12 },
  title: { fontSize: 22, fontWeight: '800', color: palette.text, lineHeight: 30 },
  description: { fontSize: 14, fontWeight: '600', color: palette.textDim, lineHeight: 22 },
  choice: { borderRadius: 20, backgroundColor: '#FFFFFF', padding: 20, gap: 8 },
  choiceTitle: { fontSize: 17, fontWeight: '800', color: palette.text },
  choiceDescription: { fontSize: 14, fontWeight: '600', color: palette.textDim },
  backChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backChipLabel: { flex: 1, fontSize: 14, fontWeight: '800', color: palette.text },
  backChipAction: { fontSize: 14, fontWeight: '800', color: palette.blue },
  examplesHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderRadius: 16,
    backgroundColor: '#F2F6FC',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  examplesHeaderText: { fontSize: 14, fontWeight: '800', color: palette.textDim },
  examples: { gap: 4, paddingHorizontal: 16 },
  exampleLine: { fontSize: 14, fontWeight: '600', color: palette.textDim, lineHeight: 22 },
  input: {
    minHeight: 112,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    padding: 16,
    fontSize: 16,
    fontWeight: '600',
    color: palette.text,
    textAlignVertical: 'top',
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  counter: { fontSize: 14, fontWeight: '600', color: palette.textDim },
  primary: {
    borderRadius: 16,
    backgroundColor: palette.blue,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  primaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
});
