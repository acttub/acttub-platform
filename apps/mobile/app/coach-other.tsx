import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ChoiceCard, type ChoiceTint } from '@/components/choice-card';
import { PrimaryButton } from '@/components/ui/buttons';
import { CtaBar } from '@/components/ui/cta-bar';
import { CoachBubble } from '@/components/ui/mascot-bubble';
import { useFocusLoad } from '@/hooks/use-focus-load';
import { palette } from '@/constants/palette';
import { space } from '@/constants/tokens';
import { translate as t } from '@/lib/i18n';
import { listScripts } from '@/lib/reading/store';

type OtherWay = 'talk' | 'myScripts' | 'script';

const WAYS: Record<OtherWay, { title: string; sub: string; icon: 'message-circle' | 'file-text' | 'edit-3'; tint: ChoiceTint; route: string; ph: string }> = {
  talk: { title: 'coachingTab.menuTalk', sub: 'coachingTab.menuTalkSub', icon: 'message-circle', tint: 'blue', route: '/talk', ph: 'coach_other_talk' },
  myScripts: { title: 'coachingTab.menuMyScripts', sub: 'coachingTab.menuMyScriptsSub', icon: 'file-text', tint: 'green', route: '/coach-scripts', ph: 'coach_other_my_scripts' },
  script: { title: 'coachingTab.menuScript', sub: 'coachingTab.menuScriptSub', icon: 'edit-3', tint: 'amber', route: '/script-cocreate', ph: 'coach_other_script' },
};

/**
 * 다시 온 사람 코칭 탭의 「다른 방법으로 코칭 받기」(SOMA-984 B안). 말로 코칭 · 내 대본으로 찍기 · 대사부터 같이 만들기를 한 화면에 모은다.
 * 새 연습 영상 고르기와 같은 선택 카드 모양이고, 첫 항목을 미리 골라 둔 채 「다음」을 누르면 원래 화면으로 간다(선택 규칙).
 * 「내 대본으로 찍기」는 저장한 대본이 있을 때만 보인다.
 */
export default function CoachOtherScreen() {
  const router = useRouter();
  const [hasScripts, setHasScripts] = useState(false);
  const [picked, setPicked] = useState<OtherWay>('talk');

  useFocusLoad((alive) => {
    listScripts()
      .then((list) => {
        if (alive()) setHasScripts(list.scripts.length > 0);
      })
      .catch(() => undefined);
  }, []);

  const ways: OtherWay[] = hasScripts ? ['talk', 'myScripts', 'script'] : ['talk', 'script'];

  return (
    <View style={styles.safe}>
      <Stack.Screen options={{ title: t('coachOther.title'), headerShadowVisible: false }} />
      <ScrollView contentContainerStyle={styles.body}>
        <CoachBubble title={t('coachOther.bubble')} guide={t('coachOther.guide')} />
        <View style={styles.choices}>
          {ways.map((way) => (
            <ChoiceCard
              key={way}
              title={t(WAYS[way].title)}
              sub={t(WAYS[way].sub)}
              icon={WAYS[way].icon}
              tint={WAYS[way].tint}
              selected={picked === way}
              phLabel={WAYS[way].ph}
              onPress={() => setPicked(way)}
            />
          ))}
        </View>
      </ScrollView>
      <CtaBar>
        <PrimaryButton label={t('coachOther.next')} phLabel="coach_other_next" onPress={() => router.push(WAYS[picked].route as never)} />
      </CtaBar>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  body: { flexGrow: 1, paddingTop: space[4], paddingHorizontal: space.gutter, paddingBottom: space[6], gap: space[3] },
  choices: { gap: space[3] },
});
