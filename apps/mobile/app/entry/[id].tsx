import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NavHeader, NavIconButton } from '@/components/ui/nav-header';
import { StatusScreen } from '@/components/ui/status-screen';
import { palette } from '@/constants/palette';
import { api } from '@/lib/api';
import { browseFailure } from '@/lib/challenge/browse';
import { translate as t } from '@/lib/i18n';

type LinkState = 'loading' | 'gone' | 'error';

/** 상태 → 상태 화면 글. 둘 다 「이번 주 챌린지 보러 가기」로 챌린지 탭에 보낸다(pen entry-link.gone·error). */
const STATUS_COPY = {
  gone: { title: 'challenges.goneTitle', body: 'challenges.goneSub' },
  error: { title: 'challenges.loadFailTitle', body: 'challenges.loadFailSub' },
} as const;

/**
 * 참여작 공유 링크로 들어오는 자리(challenge.react).
 *
 * 회원 앱에서 열면 노출 조건을 서버가 확인한 뒤 그 참여작부터 피드를 연다. 그 사이 비공개·삭제·
 * 숨김이 됐거나 차단 관계면 404 라 "볼 수 없는 영상" 안내만 한다. 세 상태 모두 흰 바탕에 머리 「참여작」과 닫기다.
 */
export default function EntryLinkScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [state, setState] = useState<LinkState>(id ? 'loading' : 'gone');

  useEffect(() => {
    if (!id) return;
    let alive = true;
    void api
      .getEntry(id)
      .then((entry) => {
        if (!alive) return;
        router.replace({ pathname: '/challenge-play', params: { id: entry.challenge_id, entryId: entry.id } });
      })
      .catch((e) => {
        if (!alive) return;
        setState(browseFailure(e).kind === 'not_found' ? 'gone' : 'error');
      });
    return () => {
      alive = false;
    };
  }, [id, router]);

  const toChallenges = () => router.dismissTo('/challenges');
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <NavHeader
        title={t('challenges.entryTitle')}
        left={
          <NavIconButton
            icon="x"
            label={t('common.close')}
            phLabel="entry_link_close"
            onPress={() => (router.canGoBack() ? router.back() : toChallenges())}
          />
        }
      />
      {state === 'loading' ? (
        <View style={styles.center}>
          <ActivityIndicator color={palette.iconFaint} accessibilityLabel={t('loadingText.loading')} />
        </View>
      ) : (
        <StatusScreen
          title={t(STATUS_COPY[state].title)}
          body={t(STATUS_COPY[state].body)}
          primary={{ label: t('challenges.goneCta'), onPress: toChallenges }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
