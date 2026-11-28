import { useLocalSearchParams, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton, SecondaryButton, TextButton } from '@/components/ui/buttons';
import { CtaBar } from '@/components/ui/cta-bar';
import { NavHeader, NavIconButton } from '@/components/ui/nav-header';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { startSceneCoaching } from '@/hooks/scene-coaching';
import { formatClipDuration } from '@/lib/archive-format';
import { logEvent } from '@/lib/analytics';
import { useAuth } from '@/lib/auth';
import { translate as t } from '@/lib/i18n';
import { setRecordScript, takeRecordScript } from '@/lib/practice/record-script';

/**
 * 장면 촬영을 마친 뒤(연습 탭 「촬영하기」, app/record-video mode=scene) 작은 결과 화면. 하단 시트 대신 화면 하나다.
 * 영상은 촬영 화면이 이미 보관함에 넣었다 — 어느 버튼을 골라도 남는다.
 *
 * - 「코치에게 보여 주기」(주 버튼): 그 영상으로 새 연습 준비(app/upload)를 열고 그 대본에 ③ 코칭 표시를 남긴다.
 * - 「다시 찍기」: 같은 대본으로 카메라를 다시 연다.
 * - 「보관함에 두기」: 그대로 연습 탭으로 돌아간다.
 */
export default function SceneTakeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ pendingId?: string; uri?: string; durationMs?: string }>();
  // 촬영 화면이 다시 찍기용으로 얹어 둔 대본(제목·배역·대본 id). 처음 그릴 때 꺼내 둔다.
  const [script] = useState(() => takeRecordScript());
  const [busy, setBusy] = useState(false);
  const uri = params.uri || null;
  const durationMs = Number(params.durationMs) || 0;
  const player = useVideoPlayer(uri, (p) => {
    p.muted = true;
  });

  const title = script?.title ?? '';
  const role = script?.role ?? '';
  const duration = formatClipDuration(Math.round(durationMs / 1000));
  const headline = role ? t('sceneTake.done', { title, role, duration }) : t('sceneTake.doneNoRole', { title, duration });

  const coach = async () => {
    if (busy) return;
    logEvent('scene_take_action', { action: 'coach' });
    if (!script?.scriptId) {
      router.replace('/upload');
      return;
    }
    setBusy(true);
    try {
      await startSceneCoaching(
        router,
        user?.id,
        { id: script.scriptId, title, roles: role ? role.split(', ') : [] },
        { pendingId: params.pendingId ?? null, uri, durationMs: durationMs || null },
        true,
      );
    } finally {
      setBusy(false);
    }
  };
  const retake = () => {
    logEvent('scene_take_action', { action: 'retake' });
    setRecordScript(script);
    router.replace({ pathname: '/record-video', params: { mode: 'scene', from: 'retake' } });
  };
  const keep = () => {
    logEvent('scene_take_action', { action: 'keep' });
    router.dismissTo('/practice');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <NavHeader
        title={t('sceneTake.title')}
        left={<NavIconButton icon="x" size={26} label={t('common.close')} phLabel="scene_take_close" onPress={keep} />}
      />
      <View style={styles.body}>
        <View style={styles.thumb}>
          {uri ? <VideoView style={StyleSheet.absoluteFill} player={player} nativeControls={false} contentFit="cover" /> : null}
        </View>
        <Text style={styles.title} accessibilityRole="header">{headline}</Text>
        <Text style={styles.sub}>{t('sceneTake.saved')}</Text>
      </View>
      <CtaBar>
        <PrimaryButton label={t('sceneTake.coach')} phLabel="scene_take_coach" loading={busy} loadingLabel={t('loadingText.preparing')} onPress={() => void coach()} />
        {script?.scriptId ? <SecondaryButton label={t('sceneTake.retake')} phLabel="scene_take_retake" onPress={retake} /> : null}
        <TextButton label={t('sceneTake.keep')} phLabel="scene_take_keep" onPress={keep} />
      </CtaBar>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space[3], paddingHorizontal: space.gutter },
  // 세로 영상 비율(3:4) 썸네일 — 화면 폭의 40%.
  thumb: { width: '40%', aspectRatio: 3 / 4, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: palette.bgSoft, marginBottom: space[2] },
  title: { ...type.title2, color: palette.text, textAlign: 'center' },
  sub: { ...type.body2, color: palette.textMeta, textAlign: 'center' },
});
