import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import { LoadingText } from '@/components/ui/loading-text';
import { palette } from '@/constants/palette';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { localCopyFor } from '@/lib/library/library-runner';
import { clearPickedVideo, setPickedVideo } from '@/lib/practice/picked-video';
import { setContinueOrigin } from '@/lib/practice/session-state';
import { loadIntoCurrent } from '@/lib/reading/store';
import { isReminderOpenKind, type ReminderOpenKind } from '@/lib/reminder-target';

type Route = Parameters<ReturnType<typeof useRouter>['replace']>[0];

/**
 * 연습 알림을 눌러 들어오는 중간 화면(SOMA-862). 알림이 말한 대상을 서버에서 확인하고 그 화면으로 바꿔 연다.
 * - homework: 그 회차 묶음의 다음 테이크 준비 화면
 * - pending_video: 그 영상을 얹은 새 연습 준비 화면
 * - unread_script: 그 대본의 리딩 준비 화면
 * 대상이 지워졌거나 못 찾으면 홈으로 간다.
 */
export default function ReminderOpenScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ kind?: string; id?: string }>();
  const kind = typeof params.kind === 'string' ? params.kind : '';
  const id = typeof params.id === 'string' ? params.id : '';

  useEffect(() => {
    let alive = true;
    const go = (route: string, result: 'opened' | 'home') => {
      if (!alive) return;
      void logEvent('reminder_target', { reminder_kind: kind || 'unknown', result });
      router.replace(route as Route);
    };
    if (!isReminderOpenKind(kind) || !id) {
      go('/(tabs)', 'home');
      return;
    }
    resolve(kind, id)
      .then((route) => (route ? go(route, 'opened') : go('/(tabs)', 'home')))
      .catch(() => go('/(tabs)', 'home'));
    return () => {
      alive = false;
    };
    // 한 번만 연다 — 같은 알림으로 다시 들어오면 새 화면이 뜬다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <LoadingText />
    </View>
  );
}

async function resolve(kind: ReminderOpenKind, id: string): Promise<string | null> {
  if (kind === 'unread_script') {
    const saved = await loadIntoCurrent(id);
    return saved ? '/reading/detail' : null;
  }
  if (kind === 'pending_video') {
    const video = await api.getVideo(id);
    if (video.purged_at) return null;
    setContinueOrigin(null);
    setPickedVideo({
      videoId: video.id,
      pendingId: null,
      uri: await localCopyFor(video.id).catch(() => null),
      playbackUrl: video.playback_url,
      durationMs: video.duration_ms,
    });
    return '/upload';
  }
  const practice = await api.getPractice(id);
  clearPickedVideo();
  setContinueOrigin({ kind: 'group', rootId: practice.root_id, practiceId: practice.id });
  return '/upload';
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.bg },
});
