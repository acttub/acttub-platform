import AsyncStorage from '@react-native-async-storage/async-storage';
import Feather from '@expo/vector-icons/Feather';
import { createAudioPlayer } from 'expo-audio';
import { Image } from 'expo-image';
import { router, type Href } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import { AppState, Linking, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { disposeAudioPlayer } from '@/lib/audio-dispose';
import { useCloudVoice } from '@/hooks/use-cloud-voice';
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
    api.getPosters({ platform: Platform.OS === 'ios' ? 'ios' : 'android', locale: currentLanguage(), app_version: APP_VERSION })
      .then((response) => { if (!cancelled) { decided.current = false; setPosters(response.posters); } })
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
  const close = () => { advance(); void logEvent('poster_close', ids); };
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
    void logEvent('poster_dismiss', ids); advance();
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
      {/* pen P1.9·P1.21 — 어두운 바탕 위 흰 카드: 그림 칸 · 배지 · 제목 · 본문 · (듣기) · 주 버튼 · 「오늘 하루 안 보기」/「닫기」. */}
      <View style={styles.backdrop}>
        <View style={[styles.card, { marginTop: insets.top, marginBottom: insets.bottom }]}>
          {image ? (
            <View style={styles.art}>
              <Image source={image} style={styles.mascot} contentFit="contain" cachePolicy="memory-disk" />
            </View>
          ) : null}
          {poster.badge ? <Text style={styles.badge}>{poster.badge}</Text> : null}
          <Text style={styles.title}>{poster.title}</Text>
          {poster.body ? <Text style={styles.body}>{poster.body}</Text> : null}
          {audio ? (
            <Pressable style={styles.sample} onPress={toggleSample} accessibilityRole="button">
              <Feather name={playing ? 'pause' : 'play'} size={16} color={palette.blue} />
              <Text style={styles.sampleText}>{t(playing ? 'poster.sampleStop' : 'poster.samplePlay')}</Text>
            </Pressable>
          ) : null}
          {cta ? <Pressable style={styles.enable} onPress={() => void press()} accessibilityRole="button"><Text style={styles.enableText}>{cta.label}</Text></Pressable> : null}
          <View style={styles.footer}>
            {poster.dismissible ? <Pressable style={styles.footerBtn} onPress={() => void dismissToday()} accessibilityRole="button"><Text style={styles.dismissText}>{t('poster.hideToday')}</Text></Pressable> : <View />}
            <Pressable style={styles.footerBtn} onPress={close} accessibilityRole="button" accessibilityLabel={t('common.close')} ph-label="poster_close"><Text style={styles.dismissText}>{t('poster.close')}</Text></Pressable>
          </View>
        </View>
      </View>
    </Modal>
    {cloud.consentSheet}
  </>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(25,31,40,0.55)', justifyContent: 'center', paddingHorizontal: 24 },
  card: { borderRadius: 24, backgroundColor: palette.card, padding: 16, paddingBottom: 8 },
  art: { height: 150, borderRadius: 16, backgroundColor: palette.blueSoft, alignItems: 'center', justifyContent: 'center' },
  mascot: { width: 130, height: 130 },
  badge: { alignSelf: 'flex-start', overflow: 'hidden', marginTop: 18, backgroundColor: palette.flameSoft, color: palette.flameDeep, borderRadius: 9999, paddingHorizontal: 12, paddingVertical: 6, fontSize: 13, fontWeight: '800' },
  title: { marginTop: 12, color: palette.text, fontSize: 21, lineHeight: 28, fontWeight: '800' },
  body: { color: palette.textMuted, fontSize: 15, lineHeight: 22, fontWeight: '400', marginTop: 8 },
  sample: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, borderRadius: 12, backgroundColor: palette.blueSoft, paddingHorizontal: 14, height: 44 },
  sampleText: { color: palette.blue, fontSize: 14, fontWeight: '700' },
  enable: { marginTop: 20, height: 52, borderRadius: 12, backgroundColor: palette.blue, alignItems: 'center', justifyContent: 'center' },
  enableText: { color: palette.onAccent, fontSize: 17, fontWeight: '700' },
  footer: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  footerBtn: { height: 44, paddingHorizontal: 8, justifyContent: 'center' },
  dismissText: { color: palette.textMuted, fontSize: 14, fontWeight: '600' },
});
