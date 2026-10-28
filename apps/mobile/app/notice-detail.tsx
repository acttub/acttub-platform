import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/buttons';
import { InlineError } from '@/components/ui/inline-error';
import { NavBackButton, NavHeader } from '@/components/ui/nav-header';
import { SkeletonDetail } from '@/components/ui/skeleton';
import { StatusScreen } from '@/components/ui/status-screen';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { api } from '@/lib/api';
import { currentLanguage, dateLocale, translate as t } from '@/lib/i18n';
import { cachedNotice, formatNoticeDate, noticeCta, noticeImageAsset, rememberNotices, type Notice, type NoticeImageAsset } from '@/lib/notices';

const IMAGES: Record<NoticeImageAsset, number> = {
  'mascot-reading': require('@/assets/images/mascot-reading.png'),
};

/**
 * 공지사항 상세(SOMA-919). 팝업 포스터와 같은 이미지 · 배지 · 제목 · 본문을 전체 화면으로 보인다.
 * 목록에서 온 공지는 바로 보이고, 목록 없이 열렸으면 목록을 받아 같은 slug 를 찾는다.
 * 끝난 공지는 버튼 없이 내용만 보인다.
 */
export default function NoticeDetailScreen() {
  const router = useRouter();
  const { slug } = useLocalSearchParams<{ slug?: string }>();
  const [notice, setNotice] = useState<Notice | null>(() => (slug ? cachedNotice(slug) : null));
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'failed'>(() => (slug && cachedNotice(slug) ? 'ready' : 'loading'));
  const [opening, setOpening] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const response = await api.getNotices({ platform: Platform.OS === 'ios' ? 'ios' : 'android', locale: currentLanguage() });
      rememberNotices(response.notices);
      const found = response.notices.find((item) => item.slug === slug) ?? null;
      setNotice(found);
      setState(found ? 'ready' : 'missing');
    } catch {
      setState('failed');
    }
  }, [slug]);

  useEffect(() => {
    if (state === 'loading' && !notice) void load();
  }, [load, notice, state]);

  const back = () => router.back();
  const header = <NavHeader title={t('notices.title')} left={<NavBackButton onPress={back} phLabel="notice_detail_back" />} />;

  if (state === 'missing') {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <Stack.Screen options={{ headerShown: false }} />
        <StatusScreen
          onBack={back}
          title={t('notices.notFound')}
          body={t('notices.notFoundBody')}
          primary={{ label: t('notices.backToList'), onPress: back }}
        />
      </SafeAreaView>
    );
  }

  const cta = notice ? noticeCta(notice) : null;
  const asset = notice ? noticeImageAsset(notice) : null;
  const image = notice?.image_url ? { uri: notice.image_url } : asset ? IMAGES[asset] : null;

  const press = () => {
    if (!cta || opening) return;
    setOpening(true);
    if (cta.kind === 'url') {
      void Linking.openURL(cta.target).catch(() => undefined).finally(() => setOpening(false));
      return;
    }
    router.push(cta.target as Href);
    setOpening(false);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      {header}
      {state === 'failed' ? (
        <View style={styles.body}>
          <InlineError message={t('notices.loadFail')} onRetry={() => void load()} />
        </View>
      ) : !notice ? (
        <SkeletonDetail media lines={5} />
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {image ? (
            <View style={styles.art}>
              <Image source={image} style={styles.image} contentFit="contain" cachePolicy="memory-disk" accessibilityIgnoresInvertColors />
            </View>
          ) : null}
          {notice.badge ? <Text style={styles.badge}>{notice.badge}</Text> : null}
          <Text style={styles.title}>{notice.title}</Text>
          <View style={styles.metaRow}>
            <Text style={[styles.status, notice.live && styles.statusLive]}>{t(notice.live ? 'notices.live' : 'notices.ended')}</Text>
            <Text style={styles.meta}>{formatNoticeDate(notice.published_at, dateLocale())}</Text>
          </View>
          {notice.body ? <Text style={styles.text}>{notice.body}</Text> : null}
          {cta ? (
            <View style={styles.cta}>
              <Button label={cta.label} onPress={press} loading={opening} loadingLabel={t('notices.openingLink')} />
            </View>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  body: { paddingHorizontal: space.gutter, paddingTop: space[2], paddingBottom: space[6], gap: space[3] },
  art: { height: 160, borderRadius: radius.lg, backgroundColor: palette.blueSoft, alignItems: 'center', justifyContent: 'center' },
  image: { width: 130, height: 130 },
  badge: { alignSelf: 'flex-start', overflow: 'hidden', backgroundColor: palette.flameSoft, color: palette.text, borderRadius: radius.full, paddingHorizontal: space[3], paddingVertical: space[1.5], ...type.captionBold },
  title: { ...type.title2, color: palette.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  status: { ...type.captionBold, color: palette.textMeta },
  statusLive: { color: palette.blueDeep },
  meta: { ...type.caption, color: palette.textMeta },
  text: { ...type.body1, color: palette.textSub },
  cta: { marginTop: space[3] },
});
