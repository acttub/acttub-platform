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
  type BlockageKind,
  type BlockageSubBranch,
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
 *
 * 화면은 목업(M6.1-R · M6.1.1-R · M6.2-R)을 따른다. 고르면 바로 넘어가지 않고
 * 라디오로 표시한 뒤 아래 버튼으로 확정한다 — 잘못 눌러 단계가 넘어가지 않게.
 */

/** 화면 안에서 짧게 쓰려고 붙인 별칭. 값은 전부 constants/palette 가 정한다. */
const c = {
  blue: palette.blue,
  blueSoft: palette.blueSoft,
  blueMist: palette.blueMist,
  blueLine: palette.blueLine,
  blueDark: palette.blueDeep,
  ink: palette.text,
  inkStrong: palette.textStrong,
  inkSub: palette.textDim,
  ink3: palette.textMuted,
  ink4: palette.textFaint,
  ink5: palette.checkOff,
  line: palette.border,
  white: palette.bg,
};

/** 목업의 대분류 예시 문구. 고른 항목에만 한 줄 더 붙는다. */
const KIND_EXAMPLE: Record<BlockageKind, string> = {
  분석: '예) “이 인물이 왜 이 말을 하는지부터 막혀요”',
  표현: '예) “뜻은 아는데 소리와 몸이 안 따라와요”',
  '그 외': '예) “무엇이 막히는지부터 잘 모르겠어요”',
};

const SUB_EXAMPLE: Record<BlockageSubBranch, string> = {
  감정: '예) “느끼려 애쓸수록 더 굳어요”',
  움직임: '예) “손이 갈 곳을 못 찾아요”',
  화술: '예) “말이 평평하게 나가요”',
  표정: '예) “얼굴이 하나로 굳어요”',
  '캐릭터 분석': '예) “이 인물이 뭘 원하는지 모르겠어요”',
  '대사 분석': '예) “이 말을 왜 하는지 모르겠어요”',
  '그 외': '예) “무엇이 막히는지부터 잘 모르겠어요”',
};

export default function BlockageScreen() {
  const router = useRouter();
  const keyboardHeight = useKeyboardHeight();
  const [state, setState] = useState<BlockageFlowState>(initialBlockageFlowState);
  // 고른 것과 확정을 나눈다. 목업이 라디오 + 아래 버튼 구조다.
  const [pickedKind, setPickedKind] = useState<BlockageKind | null>(null);
  const [pickedSub, setPickedSub] = useState<BlockageSubBranch | null>(null);

  const goDetail = () => {
    const selection = completeBlockageFlow(state);
    if (!selection) return;
    setPendingBlockage(selection);
    router.replace('/analyzing');
  };

  const confirmKind = () => {
    if (!pickedKind) return;
    setState((was) => chooseBlockageKind(was, pickedKind));
    setPickedSub(null);
  };

  const confirmSub = () => {
    if (!pickedSub) return;
    setState((was) => chooseBlockageSubBranch(was, pickedSub));
  };

  return (
    <SafeAreaView style={styles.safe} edges={keyboardHeight > 0 ? [] : ['bottom']}>
      <Stack.Screen options={{ title: '새 연습' }} />
      <View style={[styles.flex, { paddingBottom: keyboardHeight }]}>
        <ProgressRow />
        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled">
          {state.step === 'main' && (
            <>
              <View style={styles.heading}>
                <Text style={styles.question}>지금 연기에서 어느 쪽이 더 막히나요?</Text>
                <Text style={styles.subtitle}>
                  고른 쪽에 맞춰 질문을 준비할게요. 하나만 골라 주세요.
                </Text>
              </View>
              <View style={styles.list}>
                {BLOCKAGE_CHOICES.map((choice) => (
                  <Option
                    key={choice.value}
                    label={choice.value}
                    description={choice.description}
                    example={KIND_EXAMPLE[choice.value]}
                    selected={pickedKind === choice.value}
                    onPress={() => setPickedKind(choice.value)}
                  />
                ))}
              </View>
              <PrimaryButton
                label="이걸로 이어가기 →"
                disabled={!pickedKind}
                onPress={confirmKind}
              />
            </>
          )}

          {state.step === 'sub' && state.kind && (
            <>
              <View style={styles.heading}>
                <ContextChip
                  label={`고른 것 · ${state.kind}`}
                  onChange={() => {
                    setState((was) => changeBlockageKind(was));
                    setPickedKind(null);
                  }}
                />
                <Text style={styles.question}>
                  {state.kind} 중에서도 어디가 가장 막히나요?
                </Text>
                <Text style={styles.subtitle}>
                  ‘{state.kind}’을 조금만 더 좁혀 볼게요. 하나만 골라 주세요.
                </Text>
              </View>
              <View style={styles.list}>
                {subBranchChoices(state.kind).map((choice) => (
                  <Option
                    key={choice.value}
                    label={choice.value}
                    description={choice.description}
                    example={SUB_EXAMPLE[choice.value]}
                    selected={pickedSub === choice.value}
                    onPress={() => setPickedSub(choice.value)}
                  />
                ))}
              </View>
              <PrimaryButton
                label="이걸로 이어가기 →"
                disabled={!pickedSub}
                onPress={confirmSub}
              />
            </>
          )}

          {state.step === 'detail' && state.kind && state.subBranch && (
            <>
              <View style={styles.heading}>
                <ContextChip
                  label={`고른 것 · ${
                    state.kind === '그 외' ? state.kind : `${state.kind} › ${state.subBranch}`
                  }`}
                  onChange={() => setState((was) => changeBlockageSubBranch(was))}
                />
                <Text style={styles.question}>{blockageDetailTitle(state.subBranch)}</Text>
                <Text style={styles.subtitle}>
                  어느 대목에서 그랬는지, 그때 무엇을 하려 했는지까지 적으면 질문이 더
                  정확해져요.
                </Text>
              </View>

              <View style={styles.writeBlock}>
                <View style={styles.exampleBlock}>
                  <Text style={styles.exampleLead}>예를 들어 —</Text>
                  <Text style={styles.exampleBody}>
                    {blockageDetailExamples(state.subBranch).join(' · ')}
                  </Text>
                </View>
                <TextInput
                  style={styles.input}
                  placeholder="예) 마지막에 “그럼 나 갈게” 하고 돌아서는 대목이요."
                  placeholderTextColor={c.ink5}
                  value={state.detail}
                  onChangeText={(text) => setState((was) => updateBlockageDetail(was, text))}
                  multiline
                />
                <Text style={styles.counter}>
                  {state.detail.length}자 · 두세 문장이면 충분해요
                </Text>
              </View>

              <View style={styles.actionBlock}>
                <PrimaryButton label="이대로 이어가기 →" onPress={goDetail} />
                <Pressable onPress={goDetail} accessibilityRole="button" hitSlop={8}>
                  <Text style={styles.skip}>건너뛰기</Text>
                </Pressable>
              </View>
            </>
          )}

          <View style={styles.footer}>
            <Text style={styles.footerText}>
              영상에서 눈에 남은 곳을 묻고, 마지막 한 문장은 배우님이 직접 써요.
            </Text>
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

/** 3단계 진행 표시. 앞 두 단계는 지나왔고 지금이 세 번째다. */
function ProgressRow() {
  return (
    <View style={styles.progress}>
      <View style={styles.progressLeft}>
        <View style={styles.steps}>
          <View style={styles.stepDone} />
          <View style={styles.stepDone} />
          <View style={styles.stepNow} />
        </View>
        <Text style={styles.stepLabel}>3단계 · 질문 받기</Text>
      </View>
      <Text style={styles.sceneLink}>영상·장면 보기 ▾</Text>
    </View>
  );
}

function Option({
  label,
  description,
  example,
  selected,
  onPress,
}: {
  label: string;
  description: string;
  example: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.option, selected && styles.optionOn]}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}>
      <View style={[styles.radio, selected && styles.radioOn]}>
        {selected && <View style={styles.radioDot} />}
      </View>
      <View style={styles.optionText}>
        <Text style={styles.optionLabel}>{label}</Text>
        <Text style={styles.optionDescription}>{description}</Text>
        {selected && <Text style={styles.optionExample}>{example}</Text>}
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

function ContextChip({ label, onChange }: { label: string; onChange: () => void }) {
  return (
    <View style={styles.chipRow}>
      <View style={styles.chip}>
        <Text style={styles.chipText}>{label}</Text>
      </View>
      <Pressable onPress={onChange} accessibilityRole="button" hitSlop={8}>
        <Text style={styles.chipChange}>바꾸기</Text>
      </Pressable>
    </View>
  );
}

function PrimaryButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      style={[styles.primary, disabled && styles.primaryOff]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button">
      <Text style={styles.primaryLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.white },
  flex: { flex: 1 },

  progress: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  progressLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  steps: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stepDone: { width: 18, height: 3, borderRadius: 9999, backgroundColor: c.blueLine },
  stepNow: { width: 26, height: 3, borderRadius: 9999, backgroundColor: c.blue },
  stepLabel: { fontSize: 12.5, fontWeight: '700', color: c.inkSub },
  sceneLink: { fontSize: 12, fontWeight: '700', color: c.ink4 },

  body: { paddingTop: 28, paddingHorizontal: 20, paddingBottom: 20, gap: 24 },

  heading: { gap: 10 },
  question: { fontSize: 23, fontWeight: '900', color: c.ink, lineHeight: 32 },
  subtitle: { fontSize: 14, fontWeight: '600', color: c.inkSub, lineHeight: 23 },

  chipRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chip: {
    backgroundColor: c.blueSoft,
    borderRadius: 9999,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  chipText: { fontSize: 11.5, fontWeight: '800', color: c.blueDark },
  chipChange: { fontSize: 11.5, fontWeight: '700', color: c.ink4 },

  list: { gap: 4 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 12,
  },
  optionOn: { backgroundColor: c.blueMist },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: c.line,
    backgroundColor: c.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: c.blue, backgroundColor: c.blue },
  radioDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: c.white },
  optionText: { flex: 1, gap: 4 },
  optionLabel: { fontSize: 16, fontWeight: '800', color: c.ink },
  optionDescription: { fontSize: 13, fontWeight: '600', color: c.ink3 },
  optionExample: { fontSize: 12, fontWeight: '600', color: c.inkSub },
  chevron: { fontSize: 16, fontWeight: '700', color: c.ink5 },

  writeBlock: { gap: 14 },
  exampleBlock: {
    borderLeftWidth: 2,
    borderLeftColor: c.line,
    paddingLeft: 14,
    paddingVertical: 2,
    gap: 6,
  },
  exampleLead: { fontSize: 12.5, fontWeight: '800', color: c.ink4 },
  exampleBody: { fontSize: 12.5, fontWeight: '600', color: c.ink4, lineHeight: 21 },
  input: {
    minHeight: 170,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: c.blue,
    backgroundColor: c.white,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 14,
    fontWeight: '600',
    color: c.ink,
    lineHeight: 23,
    textAlignVertical: 'top',
  },
  counter: { fontSize: 11.5, fontWeight: '600', color: c.ink5 },

  actionBlock: { gap: 12, alignItems: 'center' },
  primary: {
    height: 52,
    alignSelf: 'stretch',
    borderRadius: 14,
    backgroundColor: c.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryOff: { backgroundColor: c.blueLine },
  primaryLabel: { fontSize: 15, fontWeight: '900', color: c.white },
  skip: { fontSize: 12.5, fontWeight: '700', color: c.ink4 },

  footer: { gap: 8 },
  footerText: { fontSize: 11.5, fontWeight: '600', color: c.ink5, lineHeight: 18 },
});
