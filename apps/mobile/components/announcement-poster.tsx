import AsyncStorage from '@react-native-async-storage/async-storage';
import Feather from '@expo/vector-icons/Feather';
import { createAudioPlayer } from 'expo-audio';
import { Image } from 'expo-image';
import { router, type Href } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import { AppState, Linking, Modal, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { disposeAudioPlayer } from '@/lib/audio-dispose';
import { useCloudVoice } from '@/hooks/use-cloud-voice';
import { afterHomeReady } from '@/lib/launch-splash';
import { logEvent } from '@/lib/analytics';
import { api, APP_VERSION } from '@/lib/api';
import { currentLanguage, translate as t } from '@/lib/i18n';
import {
  audioAssetOf,
  ctaOf,
  imageAssetOf,
  localDay,
  loadPosterState,
  markHiddenToday,
  markShown,
  pickPoster,
  savePosterState,
  type Poster,
  type PosterAudioAsset,
  type PosterImageAsset,
} from '@/lib/poster';
import { Button, TextButton } from '@/components/ui/buttons';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';

const IMAGES: Record<PosterImageAsset, number> = {
  'mascot-reading': require('@/assets/images/mascot-reading.png'),
};
const AUDIO: Record<PosterAudioAsset, number> = {
  'cloud-voice-sample': require('@/assets/audio/cloud-voice-sample.m4a'),
};

/**
 * 홈 진입 때 띄우는 공지 포스터(app.poster). 무엇을 띄울지는 서버가 정하고(GET /v2/app/posters), 빈도·다시 보지 않기·
 * 대상은 기기 상태로 여기서 판정한다. 요청이 실패하거나 띄울 것이 없으면 아무것도 띄우지 않는다.
 */
export function AnnouncementPoster({ loggedIn, blocked = false, onboardingJustFinished = false }: { loggedIn: boolean; blocked?: boolean; onboardingJustFinished?: boolean }) {
  const insets = useSafeAreaInsets();
  const cloud = useCloudVoice({ deferUntilHomeReady: true });
  const [posters, setPosters] = useState<Poster[] | null>(null);
  const [poster, setPoster] = useState<Poster | null>(null);
  const [visible, setVisible] = useState(false);
  const [playing, setPlaying] = useState(false);
  const player = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  const decided = useRef(false);
  const seen = useRef(new Set<string>());
  const focused = useIsFocused();
  const [entry, setEntry] = useState(0);
  const [next, setNext] = useState(0);

  useEffect(() => {
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && previous !== 'active') setEntry((value) => value + 1);
      previous = state;
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!loggedIn || !focused) return;
    decided.current = true;
    seen.current.clear();
    setPosters(null);
    setVisible(false);
    let cancelled = false;
    // 홈 첫 화면에 필요한 기록을 다 받은 뒤에 묻는다(lib/launch-splash afterHomeReady).
    afterHomeReady()
      .then(() => (cancelled ? null : api.getPosters({ platform: Platform.OS === 'ios' ? 'ios' : 'android', locale: currentLanguage(), app_version: APP_VERSION })))
      .then((response) => { if (response && !cancelled) { decided.current = false; setPosters(response.posters); } })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [loggedIn, focused, entry]);

  useEffect(() => {
    if (decided.current || !focused || !loggedIn || blocked || onboardingJustFinished || !posters || posters.length === 0) return;
    // 고품질 목소리를 아직 안 켠 사람에게만 보일 포스터가 있으면 그 상태를 받은 뒤에 고른다.
    // 상태 요청이 실패했으면 기다리지 않는다 — 그 포스터만 빼고(cloudVoice null) 나머지에서 고른다.
    if (!cloud.status && !cloud.statusFailed && posters.some((item) => item.audience === 'cloud_voice_off')) return;
    let cancelled = false;
    void loadPosterState(AsyncStorage).then((state) => {
      if (cancelled || decided.current) return;
      decided.current = true;
      const today = localDay(Date.now());
      const status = cloud.status;
      const picked = pickPoster(posters.filter((item) => !seen.current.has(item.slug)), state, {
        today,
        cloudVoice: status ? { available: status.available, enabled: cloud.enabled, consent: status.consent } : null,
      });
      if (!picked) return;
      seen.current.add(picked.slug);
      setPoster(picked);
      setVisible(true);
      void savePosterState(AsyncStorage, markShown(state, picked, today)).catch(() => undefined);
      logEvent('poster_shown', { slug: picked.slug, revision: picked.revision });
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [blocked, cloud.enabled, cloud.status, cloud.statusFailed, loggedIn, onboardingJustFinished, posters, focused, entry, next]);

  useEffect(() => () => disposeAudioPlayer(player.current), []);
  useEffect(() => {
    if (poster?.audience === 'cloud_voice_off' && cloud.enabled && cloud.status?.consent === 'granted') setVisible(false);
  }, [cloud.enabled, cloud.status?.consent, poster?.audience]);

  if (!poster) return cloud.consentSheet;

  const ids = { slug: poster.slug, revision: poster.revision };
  const image = poster.image_url ? { uri: poster.image_url } : (() => {
    const asset = imageAssetOf(poster);
    return asset ? IMAGES[asset] : null;
  })();
  const audio = audioAssetOf(poster);
  const cta = ctaOf(poster);

  const advance = () => { setVisible(false); decided.current = false; setNext((value) => value + 1); };
  const close = () => { advance(); logEvent('poster_close', ids); };
  const toggleSample = () => {
    if (!audio) return;
    if (playing) { player.current?.pause(); setPlaying(false); return; }
    if (!player.current) player.current = createAudioPlayer(AUDIO[audio]);
    player.current.play(); setPlaying(true);
  };
  const dismissToday = async () => {
    try {
      const state = await loadPosterState(AsyncStorage);
      await savePosterState(AsyncStorage, markHiddenToday(state, poster, localDay(Date.now())));
    } catch {}
    logEvent('poster_dismiss', ids); advance();
  };
  // 포스터를 먼저 닫고 다음 화면을 띄운다 — iOS 는 모달 위에 모달을 올리지 못한다.
  const press = async () => {
    if (!cta) return;
    logEvent('poster_cta', ids);
    setVisible(false);
    if (cta.kind === 'url') { void Linking.openURL(cta.target).catch(() => undefined); return; }
    await new Promise((resolve) => setTimeout(resolve, 350));
    if (cta.kind === 'cloud_voice_enable') await cloud.enable('promo');
    else router.push(cta.target as Href);
  };

  return <>
    <Modal visible={visible} animationType="fade" transparent onRequestClose={close} statusBarTranslucent>
      {/* SOMA-927 시안 A — 어두운 바탕 위 흰 카드: 그림 칸(꽉 찬 폭) · 눈썹 글자 · 제목 · 본문 · (듣기) · 각주 · 주 버튼 · 「오늘 하루 안 보기」/「닫기」. */}
      <View style={styles.backdrop}>
        <View style={[styles.card, { marginTop: insets.top, marginBottom: insets.bottom }]}>
          {image ? (
            <View style={[styles.art, { backgroundColor: poster.image_bg ?? palette.blueSoft }]}>
              <Image source={image} style={styles.mascot} contentFit="contain" cachePolicy="memory-disk" />
            </View>
          ) : null}
          <View style={styles.content}>
            {poster.badge ? <Text style={styles.badge}>{poster.badge}</Text> : null}
            <Text style={styles.title}>{poster.title}</Text>
            {poster.body ? <Text style={styles.body}>{poster.body}</Text> : null}
            {audio ? (
              <Button
                size="sm"
                style={styles.sample}
                onPress={toggleSample}
                icon={<Feather name={playing ? 'pause' : 'play'} size={16} color={palette.blueDeep} />}
                label={t(playing ? 'poster.sampleStop' : 'poster.samplePlay')}
              />
            ) : null}
            {poster.footnote ? <Text style={styles.footnote}>{poster.footnote}</Text> : null}
            {cta ? <Button style={styles.enable} onPress={() => void press()} label={cta.label} /> : null}
            <View style={styles.footer}>
              {poster.dismissible ? <TextButton onPress={() => void dismissToday()} label={t('poster.hideToday')} /> : <View />}
              <TextButton onPress={close} accessibilityLabel={t('common.close')} phLabel="poster_close" label={t('poster.close')} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
    {cloud.consentSheet}
  </>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: palette.scrim, justifyContent: 'center', paddingHorizontal: space[6] },
  card: { borderRadius: radius.xl, backgroundColor: palette.bg, overflow: 'hidden' },
  art: { height: 170, alignItems: 'center', justifyContent: 'center' },
  mascot: { width: 170, height: 170 },
  content: { paddingHorizontal: space[6], paddingTop: space[6], paddingBottom: space[2] },
  badge: { ...type.captionBold, color: palette.blueDeep },
  title: { ...type.title2, marginTop: space[1], color: palette.text },
  body: { ...type.body2, color: palette.textSub, marginTop: space[2] },
  footnote: { ...type.caption, marginTop: space[3], color: palette.textMeta },
  sample: { alignSelf: 'flex-start', marginTop: space[3] },
  enable: { marginTop: space[6] },
  footer: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space[1] },
});
