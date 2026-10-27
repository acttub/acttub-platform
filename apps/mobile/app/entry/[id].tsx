import Feather from '@expo/vector-icons/Feather';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { api } from '@/lib/api';
import { browseFailure } from '@/lib/challenge/browse';
import { translate as t } from '@/lib/i18n';

/**
 * 참여작 공유 링크로 들어오는 자리(challenge.react).
 *
 * 회원 앱에서 열면 노출 조건을 서버가 확인한 뒤 그 참여작부터 피드를 연다. 그 사이 비공개·삭제·
 * 숨김이 됐거나 차단 관계면 404 라 "볼 수 없는 영상" 안내만 한다.
 */
export default function EntryLinkScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setError(t('react.linkGone'));
      return;
    }
    let alive = true;
    void api
      .getEntry(id)
      .then((entry) => {
        if (!alive) return;
        router.replace({ pathname: '/challenge-play', params: { id: entry.challenge_id, entryId: entry.id } });
      })
      .catch((e) => {
        if (!alive) return;
        const failure = browseFailure(e);
        setError(failure.kind === 'not_found' ? t('react.linkGone') : t('challenges.loadFail'));
      });
    return () => {
      alive = false;
    };
  }, [id, router]);

  const gone = error === t('react.linkGone');
  const light = !gone;
  return (
    <View style={[styles.safe, light && styles.safeLight]}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={[styles.safe, light && styles.safeLight]} edges={['top', 'bottom']}>
        {/* pen C13.2 — 검은 바탕에 영상 없음 아이콘 · 제목 · 안내 · 「이번 주 챌린지 보러 가기」. 위 닫기로 나간다. */}
        <Pressable style={styles.close} onPress={() => (router.canGoBack() ? router.back() : router.dismissTo('/challenges'))} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('common.close')}>
          <Feather name="x" size={26} color={light ? palette.text : '#FFFFFF'} />
        </Pressable>
        <View style={styles.center}>
          {!error ? null : error === t('react.linkGone') ? (
            <>
              <Feather name="video-off" size={30} color="#FFFFFF" />
              <Text style={styles.title}>{t('challenges.goneTitle')}</Text>
              <Text style={styles.message}>{t('challenges.goneSub')}</Text>
              <Pressable style={styles.cta} onPress={() => router.dismissTo('/challenges')} accessibilityRole="button">
                <Text style={styles.ctaText}>{t('challenges.goneCta')}</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.messageLight}>{error}</Text>
              <Pressable style={styles.ctaBlue} onPress={() => router.dismissTo('/challenges')} accessibilityRole="button">
                <Text style={styles.ctaBlueText}>{t('challenges.goneCta')}</Text>
              </Pressable>
            </>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000000' },
  safeLight: { backgroundColor: palette.bg },
  messageLight: { fontSize: 15, color: palette.textSub, textAlign: 'center', lineHeight: 22 },
  ctaBlue: { backgroundColor: palette.blue, borderRadius: 14, paddingHorizontal: 20, paddingVertical: 13, alignItems: 'center', justifyContent: 'center' },
  ctaBlueText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
  close: { position: 'absolute', top: 56, left: 20, zIndex: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 28 },
  title: { fontSize: 17, fontWeight: '800', color: '#FFFFFF', textAlign: 'center', marginTop: 6 },
  message: { fontSize: 13.5, color: 'rgba(255,255,255,0.7)', textAlign: 'center', lineHeight: 21 },
  cta: { backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 14, paddingHorizontal: 20, height: 44, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  ctaText: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },
});
