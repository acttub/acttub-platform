import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import { LoadingText } from '@/components/ui/loading-text';
import { palette } from '@/constants/palette';
import { inviteCodeFromParam, rememberPendingInviteCode } from '@/lib/invite';

/**
 * 초대 딥링크(`actingapp://invite?code=XXXXXX`, SOMA-865)로 들어오는 중간 화면. 코드를 기기에 맡기고 프로필 탭으로 바꿔 연다 —
 * 프로필의 「초대 코드 입력」 칸이 열려 있으면 그 코드를 채워 둔다. 아직 로그인 전이면 가입을 마친 뒤 프로필에서 채워진다.
 */
export default function InviteOpenScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string | string[] }>();

  useEffect(() => {
    let alive = true;
    const code = inviteCodeFromParam(params.code);
    void (code ? rememberPendingInviteCode(code) : Promise.resolve()).then(() => {
      // replace 하면 탭 묶음이 하나 더 쌓인다 — 이미 있는 탭까지 내려간다(SOMA-853).
      if (alive) router.dismissTo('/profile');
    });
    return () => {
      alive = false;
    };
    // 한 번만 연다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <LoadingText />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.bg },
});
