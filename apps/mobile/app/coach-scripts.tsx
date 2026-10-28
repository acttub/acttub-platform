import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChoiceCard } from '@/components/ds/choice-card';
import { SkeletonRows } from '@/components/ds/ui/skeleton';
import { PrimaryButton, TextButton } from '@/components/ds/ui/buttons';
import { CtaBar } from '@/components/ds/ui/cta-bar';
import { MascotBubble } from '@/components/ds/ui/mascot-bubble';
import { NavHeader, NavIconButton } from '@/components/ds/ui/nav-header';
import { palette } from '@/constants/palette';
import { space } from '@/constants/tokens';
import { logEvent } from '@/lib/analytics';
import { translate as t } from '@/lib/i18n';
import { recordScriptFromDetail, setRecordScript } from '@/lib/practice/record-script';
import { setContinueOrigin } from '@/lib/practice/session-state';
import { readingCoachScene } from '@/lib/reading/redesign-748';
import { getScriptDetail, listScripts, rememberedMyRoles } from '@/lib/reading/store';
import type { ScriptCard } from '@/lib/reading/types';

/**
 * 코칭 「내 대본으로 찍기」 — 저장한 대본(리딩·대본 만들기·붙여 넣기 모두 같은 목록) 중 하나를 고르고 「다음」을
 * 누르면, 리딩 끝 → 코칭과 같이 대본 제목·내 배역을 새 연습 장면 칸에 채워 카메라로 간다.
 */
export default function CoachScriptsScreen() {
  const router = useRouter();
  const [scripts, setScripts] = useState<ScriptCard[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listScripts()
      // 서버의 내 배역은 리딩 회차에서만 온다. 아직 읽지 않은 대본은 대본 만들기 때 이 기기에 기억한 배역을 쓴다.
      .then((list) =>
        Promise.all(
          list.scripts.map(async (card) =>
            card.my_character_names.length > 0 ? card : { ...card, my_character_names: await rememberedMyRoles(card.id) },
          ),
        ),
      )
      .then((cards) => {
        if (!cancelled) {
          setScripts(cards);
          // 첫 대본을 미리 골라 둔다(UX 가이드 5절, 10/23).
          setPicked((was) => was ?? cards[0]?.id ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 고른 대본의 줄을 받아 촬영 화면 대본 카드와 장면 칸(제목·첫 장면·내 배역)을 채운다. 줄을 못 받으면 제목·배역만 채우고 간다.
  const record = async () => {
    const script = scripts?.find((s) => s.id === picked);
    if (!script || opening) return;
    setOpening(true);
    const detail = await getScriptDetail(script.id).catch(() => null);
    setOpening(false);
    const myRoles = script.my_character_names;
    setRecordScript(detail ? recordScriptFromDetail(detail, myRoles) : null);
    setContinueOrigin({
      kind: 'reading',
      scene: readingCoachScene({
        title: script.title,
        lineIds: detail ? detail.lines.map((l) => l.id) : [],
        scenes: detail?.scenes ?? [],
        startIndex: 0,
        myRoles,
        t,
      }),
    });
    void logEvent('coach_my_script_record', { script_id: script.id });
    router.push({ pathname: '/record-video', params: { mode: 'ai', next: 'upload' } });
  };

  const empty = scripts !== null && scripts.length === 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <NavHeader
        title={t('coachScripts.title')}
        left={<NavIconButton icon="chevron-left" size={26} label={t('common.back')} phLabel="coach_scripts_back" onPress={() => router.back()} />}
      />
      {scripts === null && !failed ? (
        <SkeletonRows count={4} />
      ) : (
        <View style={styles.flex}>
          <ScrollView contentContainerStyle={styles.body}>
            <MascotBubble
              title={t(empty || failed ? 'coachScripts.emptyTitle' : 'coachScripts.ask')}
              guide={failed ? t('coachScripts.failed') : empty ? t('coachScripts.emptySub') : t('coachScripts.guide')}
            />
            {(scripts ?? []).map((script) => (
              <ChoiceCard
                key={script.id}
                title={script.title}
                sub={t('coachScripts.rowSub', {
                  count: script.dialogue_count,
                  roles: script.my_character_names.length > 0 ? script.my_character_names.join(', ') : t('coachScripts.noRole'),
                })}
                // pen P13.8 — 왼쪽 문서 아이콘(파랑, 칸 없음), 오른쪽 빈 동그라미 → 고르면 파란 체크.
                icon="file-text"
                tint="plain"
                mark="radio"
                selected={picked === script.id}
                phLabel="coach_scripts_pick"
                onPress={() => setPicked(script.id)}
              />
            ))}
          </ScrollView>
          <CtaBar>
            {empty || failed ? (
              <PrimaryButton label={t('coachScripts.make')} phLabel="coach_scripts_make" onPress={() => router.replace('/script-cocreate')} />
            ) : (
              <>
                <TextButton label={t('coachScripts.make')} phLabel="coach_scripts_make" onPress={() => router.replace('/script-cocreate')} />
                <PrimaryButton
                  label={t('coachScripts.next')}
                  phLabel="coach_scripts_next"
                  disabled={!picked}
                  loading={opening}
                  loadingLabel={t('coachScripts.opening')}
                  onPress={() => void record()}
                />
              </>
            )}
          </CtaBar>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  flex: { flex: 1 },
  body: { paddingTop: space[4], paddingHorizontal: space.gutter, paddingBottom: space[6], gap: space[3] },
});
