import AsyncStorage from '@react-native-async-storage/async-storage';
import Feather from '@expo/vector-icons/Feather';
import { createAudioPlayer } from 'expo-audio';
import { Image } from 'expo-image';
import { router, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Linking, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCloudVoice } from '@/hooks/use-cloud-voice';
import { logEvent } from '@/lib/analytics';
import { api, APP_VERSION } from '@/lib/api';
import { currentLanguage, translate as t } from '@/lib/i18n';
import {
  audioAssetOf,
  ctaOf,
  imageAssetOf,
  koreaDay,
  loadPosterState,
  markDismissed,
  markShown,
  pickPoster,
  savePosterState,
  type Poster,
  type PosterAudioAsset,
  type PosterImageAsset,
} from '@/lib/poster';
import { palette } from '@/constants/palette';

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
  const cloud = useCloudVoice();
  const [posters, setPosters] = useState<Poster[] | null>(null);
  const [poster, setPoster] = useState<Poster | null>(null);
  const [visible, setVisible] = useState(false);
  const [playing, setPlaying] = useState(false);
  const player = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  const decided = useRef(false);

  useEffect(() => {
    if (!loggedIn) return;
    let cancelled = false;
    api.getPosters({ platform: Platform.OS === 'ios' ? 'ios' : 'android', locale: currentLanguage(), app_version: APP_VERSION })
      .then((response) => { if (!cancelled) setPosters(response.posters); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [loggedIn]);

  useEffect(() => {
    if (decided.current || !loggedIn || blocked || onboardingJustFinished || !posters || posters.length === 0) return;
    // 고품질 목소리를 아직 안 켠 사람에게만 보일 포스터가 있으면 그 상태를 받은 뒤에 고른다.
    if (!cloud.status && posters.some((item) => item.audience === 'cloud_voice_off')) return;
    let cancelled = false;
    void loadPosterState(AsyncStorage).then((state) => {
      if (cancelled || decided.current) return;
      decided.current = true;
      const today = koreaDay(Date.now());
      const status = cloud.status;
      const picked = pickPoster(posters, state, {
        today,
        cloudVoice: status ? { available: status.available, enabled: cloud.enabled, consent: status.consent } : null,
      });
      if (!picked) return;
      setPoster(picked);
      setVisible(true);
      void savePosterState(AsyncStorage, markShown(state, picked, today)).catch(() => undefined);
      logEvent('poster_shown', { slug: picked.slug, revision: picked.revision });
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [blocked, cloud.enabled, cloud.status, loggedIn, onboardingJustFinished, posters]);

  useEffect(() => () => { try { player.current?.remove(); } catch {} }, []);
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

  const close = () => { setVisible(false); logEvent('poster_close', ids); };
  const toggleSample = () => {
    if (!audio) return;
    if (playing) { player.current?.pause(); setPlaying(false); return; }
    if (!player.current) player.current = createAudioPlayer(AUDIO[audio]);
    player.current.play(); setPlaying(true);
  };
  const dismissForever = async () => {
    try {
      const state = await loadPosterState(AsyncStorage);
      await savePosterState(AsyncStorage, markDismissed(state, poster));
    } catch {}
    logEvent('poster_dismiss', ids); setVisible(false);
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
    <Modal visible={visible} animationType="fade" onRequestClose={close} statusBarTranslucent>
      <View style={[styles.screen, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 20 }]}>
        <Pressable style={styles.close} onPress={close} accessibilityLabel={t('common.close')}><Feather name="x" size={22} color={palette.text} /></Pressable>
        <View style={styles.center}>
          {poster.badge ? <Text style={styles.badge}>{poster.badge}</Text> : null}
          <Text style={styles.title}>{poster.title}</Text>
          {poster.body ? <Text style={styles.body}>{poster.body}</Text> : null}
          {image || audio ? (
            <View style={styles.artRow}>
              {image ? <Image source={image} style={styles.mascot} contentFit="contain" /> : null}
              {audio ? <Pressable style={styles.sample} onPress={toggleSample}><Feather name={playing ? 'pause' : 'play'} size={16} color={palette.flameDeep} /><Text style={styles.sampleText}>{t(playing ? 'poster.sampleStop' : 'poster.samplePlay')}</Text></Pressable> : null}
            </View>
          ) : null}
        </View>
        {cta ? <Pressable style={styles.enable} onPress={() => void press()}><Text style={styles.enableText}>{cta.label}</Text></Pressable> : null}
        {poster.dismissible ? <Pressable style={styles.dismiss} onPress={() => void dismissForever()}><Text style={styles.dismissText}>{t('poster.dismissForever')}</Text></Pressable> : null}
      </View>
    </Modal>
    {cloud.consentSheet}
  </>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 24, backgroundColor: palette.flameSoft },
  close: { alignSelf: 'flex-end', width: 44, height: 44, borderRadius: 22, backgroundColor: palette.bg, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  badge: { backgroundColor: palette.bg, color: palette.flameDeep, borderRadius: 9999, paddingHorizontal: 16, paddingVertical: 8, fontSize: 13, fontWeight: '800', marginBottom: 20 },
  title: { color: palette.text, fontSize: 30, lineHeight: 39, fontWeight: '900', textAlign: 'center' },
  body: { color: palette.textDim, fontSize: 15, lineHeight: 23, fontWeight: '600', textAlign: 'center', marginTop: 14 },
  artRow: { flexDirection: 'row', alignItems: 'center', marginTop: 20 },
  mascot: { width: 180, height: 180 },
  sample: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 9999, backgroundColor: palette.bg, paddingHorizontal: 14, height: 42 },
  sampleText: { color: palette.flameDeep, fontSize: 14, fontWeight: '800' },
  enable: { height: 56, borderRadius: 9999, backgroundColor: palette.flame, alignItems: 'center', justifyContent: 'center' },
  enableText: { color: palette.onAccent, fontSize: 17, fontWeight: '900' },
  dismiss: { height: 46, alignItems: 'center', justifyContent: 'center' },
  dismissText: { color: palette.textMuted, fontSize: 14, fontWeight: '700' },
});
