import Feather from '@expo/vector-icons/Feather';
import { useState, type ComponentProps } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui/buttons';
import { MASCOT } from '@/components/ui/mascot';
import { MascotBubble } from '@/components/ui/mascot-bubble';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { translate as t, translateList } from '@/lib/i18n';

/** 고른 길 → 「다음」이 가는 탭. 챌린지는 첫 연습을 끝낸 뒤에 보인다(SOMA-827) — 코칭·리딩 둘만. */
export type FirstPick = 'coaching' | 'reading';

/**
 * 첫 사용자 안내(pen P1.12 「뭐부터 해 볼까요?」, 예전 첫 사용자 홈 — SOMA-1120에서 처음 한 번 뜨는 화면으로 옮김).
 * 액티 말풍선 아래에서 하나를 고르면(회색 → 옅은 파랑) 「다음」으로 그 탭에 들어간다. 첫 항목(코칭)을 미리 골라 둔다(10/23).
 * 탭 위를 덮는 전체 화면이다 — 아래에서 올라오는 시트가 아니다. 띄울지는 탭 레이아웃(components/tab-launch-overlays)이 정한다.
 */
export function FirstUseIntro({ name, onContinue }: { name: string; onContinue: (pick: FirstPick) => void }) {
  const [pick, setPick] = useState<FirstPick>('coaching');
  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']} testID="first-use-intro">
      <ScrollView contentContainerStyle={styles.container}>
        <MascotBubble source={MASCOT.coach} title={name ? t('home.firstHello', { name }) : t('home.firstHelloNoName')} guide={t('home.firstIntro')} />
        <View style={styles.question}>
          <Text style={styles.questionTitle} accessibilityRole="header">{t('home.firstQuestion')}</Text>
          <Text style={styles.questionSub}>{t('home.firstPickSub')}</Text>
        </View>
        <View style={styles.choices}>
          <FirstChoice
            icon="video"
            title={t('home.firstCoaching')}
            sub={t('home.firstCoachingSub')}
            steps={translateList('home.firstCoachingSteps')}
            selected={pick === 'coaching'}
            phLabel="home_first_coaching"
            onPress={() => setPick('coaching')}
          />
          <FirstChoice
            icon="book-open"
            title={t('home.firstReading')}
            sub={t('home.firstReadingSub')}
            steps={translateList('home.firstReadingSteps')}
            selected={pick === 'reading'}
            phLabel="home_first_reading"
            onPress={() => setPick('reading')}
          />
        </View>
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton label={t('home.firstContinue')} phLabel="home_first_continue" onPress={() => onContinue(pick)} />
      </View>
    </SafeAreaView>
  );
}

/**
 * 고르는 카드(pen P1.12~P1.14) — 안 골랐을 땐 회색 카드에 아이콘 칸·제목·설명·오른쪽 빈 라디오.
 * 고르면 옅은 파랑 바탕·파란 테두리에 라디오가 차고, 카드 안에 「이렇게 진행돼요」 세 단계가 펼쳐진다.
 */
function FirstChoice({
  icon,
  title,
  sub,
  steps,
  selected,
  phLabel,
  onPress,
}: {
  icon: ComponentProps<typeof Feather>['name'];
  title: string;
  sub: string;
  steps?: string[];
  selected: boolean;
  phLabel: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={title}
      accessibilityHint={sub}
      ph-label={phLabel}
      style={({ pressed }) => [styles.choice, selected && styles.choiceOn, pressed && !selected && styles.pressed]}>
      <View style={styles.choiceTop}>
        <View style={styles.choiceIcon}>
          <Feather name={icon} size={20} color={palette.blue} />
        </View>
        <View style={styles.flex}>
          <Text style={[styles.choiceText, selected && styles.choiceTextOn]}>{title}</Text>
          <Text style={styles.choiceSub}>{sub}</Text>
        </View>
        <View style={[styles.radio, selected && styles.radioOn]}>
          {selected ? <Feather name="check" size={14} color={palette.onAccent} /> : null}
        </View>
      </View>
      {selected && steps && steps.length > 0 ? (
        <View style={styles.steps}>
          <Text style={styles.stepsTitle}>{t('home.firstStepsLabel')}</Text>
          {steps.map((text, i) => (
            <View key={i} style={styles.stepRow}>
              <View style={styles.stepNum}>
                <Text style={styles.stepNumText}>{i + 1}</Text>
              </View>
              <Text style={styles.stepText}>{text}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, backgroundColor: palette.bg },
  flex: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.85 },
  container: { paddingTop: space[8], paddingHorizontal: space.gutter, paddingBottom: space[6] },
  question: { gap: space[1], paddingTop: space[8] },
  questionTitle: { ...type.title2, color: palette.text },
  questionSub: { ...type.caption, color: palette.textMeta },
  choices: { gap: space[3], paddingTop: space[4] },
  footer: { paddingHorizontal: space.gutter, paddingTop: space[2], paddingBottom: space[3] },
  choice: {
    gap: space[3],
    paddingVertical: space[5],
    paddingHorizontal: space[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.bg,
  },
  choiceOn: { backgroundColor: palette.blueSoft, borderColor: palette.blue, borderWidth: 1.5 },
  choiceTop: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3] },
  choiceIcon: { width: 40, height: 40, borderRadius: radius.full, backgroundColor: palette.blueSoft, alignItems: 'center', justifyContent: 'center' },
  choiceText: { ...type.body1Bold, color: palette.text },
  choiceTextOn: { color: palette.blueDeep },
  choiceSub: { marginTop: space[1], ...type.body2, color: palette.textSub },
  radio: { width: 22, height: 22, borderRadius: radius.full, borderWidth: 1.5, borderColor: palette.textDisabled, backgroundColor: palette.bg, alignItems: 'center', justifyContent: 'center' },
  radioOn: { backgroundColor: palette.blue, borderColor: palette.blue },
  steps: { gap: space[2], paddingTop: space[3], borderTopWidth: 1, borderTopColor: palette.border },
  stepsTitle: { ...type.captionBold, color: palette.blueDeep },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  stepNum: { width: 20, height: 20, borderRadius: radius.full, backgroundColor: palette.bg, alignItems: 'center', justifyContent: 'center' },
  stepNumText: { ...type.micro, color: palette.blueDeep },
  stepText: { flex: 1, ...type.body2, color: palette.text },
});
