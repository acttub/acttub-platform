import { CommonActions, type TabNavigationState } from '@react-navigation/native';
import { useFocusEffect, useNavigation } from 'expo-router';
import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';

import { palette } from '@/constants/palette';
import { logEvent } from '@/lib/analytics';
import { resolveLaunchTab, takeLaunchVisit } from '@/lib/last-tab';

/**
 * '/'(탭 index) — 홈 탭은 없어졌다(SOMA-1120). 화면은 없고 마지막에 쓴 탭(lib/last-tab, 처음이면 리딩)으로 넘긴다.
 * 탭 바에는 보이지 않는다. 앱을 열 때와 다른 화면의 「홈으로」(dismissTo('/(tabs)'), navigate('/'))가 여기로 온다.
 * 앱을 열 때 한 번만 app_open_tab { tab, restored } 을 남긴다.
 *
 * 넘길 때 탭 기록을 그 탭 하나로 다시 쓴다 — 기록에 이 자리가 남으면 뒤로가기가 여기로 돌아와 다시 넘기기를 되풀이한다.
 */
export default function LastTabRedirect() {
  const navigation = useNavigation();
  useFocusEffect(
    useCallback(() => {
      let live = true;
      void resolveLaunchTab().then(({ tab, restored }) => {
        if (!live) return;
        if (takeLaunchVisit()) logEvent('app_open_tab', { tab, restored: restored ? 'yes' : 'no' });
        const state = navigation.getState() as TabNavigationState<Record<string, object | undefined>> | undefined;
        const index = state?.routes.findIndex((r) => r.name === tab) ?? -1;
        if (!state || index < 0) return;
        navigation.dispatch({
          ...CommonActions.reset({ ...state, index, history: [{ type: 'route', key: state.routes[index].key }] } as never),
          target: state.key,
        });
      });
      return () => {
        live = false;
      };
    }, [navigation]),
  );
  return <View style={styles.blank} />;
}

const styles = StyleSheet.create({
  blank: { flex: 1, backgroundColor: palette.bg },
});
