import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  BLOCKAGE_CHOICES,
  skippedBlockageSelection,
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
import { peekPendingUpload, setPendingBlockage } from '@/lib/practice';
import { SceneFoldBody, SceneFoldLink, SceneSummary } from '@/components/practice-chrome';
import { previewScene, previewVideoSource } from '@/lib/preview-video';
import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';

/**
 * 막히는 지점 고르기 — 장면을 적은 뒤, 분석을 시작하기 전 단계.
 *
 * 서버가 이 선택으로 코치를 가른다(분석/표현). 건너뛰면 '그 외'로 보낸다(SOMA-432) —
 * 웹과 같은 선택지·같은 순서를 쓴다. 플랫폼마다 다른 값을 보내면 같은 배우가
 * 기기에 따라 다른 질문을 받는다.
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

/** 값은 서버 계약(한국어)이라 그대로 두고, 화면 라벨·예시만 언어 파일에서 꺼낸다. */
const kindLabel = (value: BlockageKind | BlockageSubBranch) => t(`blockage.kindLabel.${value}`);
const example = (value: BlockageKind | BlockageSubBranch) => t(`blockage.examplePh.${value}`);

export default function BlockageScreen() {
  const router = useRouter();
  const keyboardHeight = useKeyboardHeight();
  const [state, setState] = useState<BlockageFlowState>(initialBlockageFlowState);
  // 고른 것과 확정을 나눈다. 목업이 라디오 + 아래 버튼 구조다.
  const [pickedKind, setPickedKind] = useState<BlockageKind | null>(null);
  const [pickedSub, setPickedSub] = useState<BlockageSubBranch | null>(null);
  const params = useLocalSearchParams();
  const preview = params.preview === '1';
  const [sceneOpen, setSceneOpen] = useState(false);
  // 소비하지 않고 읽는다 — take 로 꺼내면 다음 화면(분석)이 대기물을 못 받는다.
  const pending = peekPendingUpload();
  const sceneVideo = pending?.video.uri || previewVideoSource(preview);
  const scene = pending?.scene ?? previewScene(preview);

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

  // 잘 모르겠으면 고르지 않아도 된다 — '그 외'로 보내면 코치가 대화에서 좁혀간다.
  const skipAll = () => {
    setPendingBlockage(skippedBlockageSelection());
    router.replace('/analyzing');
  };

  const confirmSub = () => {
    if (!pickedSub) return;
    setState((was) => chooseBlockageSubBranch(was, pickedSub));
  };

  return (
    <SafeAreaView style={styles.safe} edges={keyboardHeight > 0 ? [] : ['bottom']}>
      <Stack.Screen options={{ title: t('blockage.screenTitle') }} />
      <View style={[styles.flex, { paddingBottom: keyboardHeight }]}>
        <ProgressRow
          sceneOpen={sceneOpen}
          onToggleScene={() => setSceneOpen((was) => !was)}
        />
        <SceneFoldBody open={sceneOpen} videoUri={sceneVideo} />
        {sceneOpen && scene && (
          <View style={styles.sceneSummary}>
            <SceneSummary scene={scene} blockage={null} />
          </View>
        )}
        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled">
          {state.step === 'main' && (
            <>
              <View style={styles.heading}>
                <Text style={styles.question}>{t('blockage.q1')}</Text>
                <Text style={styles.subtitle}>{t('blockage.q1Hint')}</Text>
              </View>
              <View style={styles.list}>
                {BLOCKAGE_CHOICES.map((choice) => (
                  <Option
                    key={choice.value}
                    label={kindLabel(choice.value)}
                    description={choice.description}
                    example={example(choice.value)}
                    selected={pickedKind === choice.value}
                    onPress={() => setPickedKind(choice.value)}
                  />
                ))}
              </View>
              <View style={styles.actionBlock}>
                <PrimaryButton
                  label={t('blockage.continueBtn')}
                  disabled={!pickedKind}
                  onPress={confirmKind}
                />
                <Pressable onPress={skipAll} accessibilityRole="button" hitSlop={8}>
                  <Text style={styles.skip}>{t('blockage.dontKnowSkip')}</Text>
                </Pressable>
              </View>
            </>
          )}

          {state.step === 'sub' && state.kind && (
            <>
              <View style={styles.heading}>
                <ContextChip
                  label={t('blockage.pickedChip', { label: kindLabel(state.kind) })}
                  onChange={() => {
                    setState((was) => changeBlockageKind(was));
                    setPickedKind(null);
                  }}
                />
                <Text style={styles.question}>
                  {t('blockage.q2', { label: kindLabel(state.kind) })}
                </Text>
                <Text style={styles.subtitle}>
                  {t('blockage.q2Hint', { label: kindLabel(state.kind) })}
                </Text>
              </View>
              <View style={styles.list}>
                {subBranchChoices(state.kind).map((choice) => (
                  <Option
                    key={choice.value}
                    label={kindLabel(choice.value)}
                    description={choice.description}
                    example={example(choice.value)}
                    selected={pickedSub === choice.value}
                    onPress={() => setPickedSub(choice.value)}
                  />
                ))}
              </View>
              <PrimaryButton
                label={t('blockage.continueBtn')}
                disabled={!pickedSub}
                onPress={confirmSub}
              />
            </>
          )}

          {state.step === 'detail' && state.kind && state.subBranch && (
            <>
              <View style={styles.heading}>
                <ContextChip
                  label={t('blockage.pickedChip', {
                    label:
                      state.kind === '그 외'
                        ? kindLabel(state.kind)
                        : `${kindLabel(state.kind)} › ${kindLabel(state.subBranch)}`,
                  })}
                  onChange={() => setState((was) => changeBlockageSubBranch(was))}
                />
                <Text style={styles.question}>{blockageDetailTitle(state.subBranch)}</Text>
                <Text style={styles.subtitle}>{t('blockage.detailLead')}</Text>
              </View>

              <View style={styles.writeBlock}>
                <View style={styles.exampleBlock}>
                  <Text style={styles.exampleLead}>{t('blockage.exampleLead')}</Text>
                  <Text style={styles.exampleBody}>
                    {blockageDetailExamples(state.subBranch).join(' · ')}
                  </Text>
                </View>
                <TextInput
                  style={styles.input}
                  placeholder={t('blockage.detailPh')}
                  placeholderTextColor={c.ink5}
                  value={state.detail}
                  onChangeText={(text) => setState((was) => updateBlockageDetail(was, text))}
                  multiline
                />
                <Text style={styles.counter}>
                  {t('blockage.charCount', { count: state.detail.length })}
                </Text>
              </View>

              <View style={styles.actionBlock}>
                <PrimaryButton label={t('blockage.continueDetail')} onPress={goDetail} />
                <Pressable onPress={goDetail} accessibilityRole="button" hitSlop={8}>
                  <Text style={styles.skip}>{t('blockage.skip')}</Text>
                </Pressable>
              </View>
            </>
          )}

          <View style={styles.footer}>
            <Text style={styles.footerText}>{t('blockage.intro')}</Text>
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

/**
 * 3단계 진행 표시. 앞 두 단계는 지나왔고 지금이 세 번째다.
 *
 * 접이식 상태는 화면이 든다 — 펼친 영상은 이 좁은 가로 줄 안이 아니라 아래쪽에
 * 전폭으로 그려야 찌그러지지 않는다.
 */
function ProgressRow({ sceneOpen, onToggleScene }: { sceneOpen: boolean; onToggleScene: () => void }) {
  return (
    <View style={styles.progress}>
      <View style={styles.progressLeft}>
        <View style={styles.steps}>
          <View style={styles.stepDone} />
          <View style={styles.stepDone} />
          <View style={styles.stepNow} />
        </View>
        <Text style={styles.stepLabel}>{t('blockage.step3')}</Text>
      </View>
      <SceneFoldLink open={sceneOpen} onToggle={onToggleScene} label={t('blockage.sceneFold')} />
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
        <Text style={styles.chipChange}>{t('blockage.change')}</Text>
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
  sceneSummary: { paddingHorizontal: 20, paddingTop: 12 },

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
