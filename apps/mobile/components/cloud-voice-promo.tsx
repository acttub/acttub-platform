import AsyncStorage from '@react-native-async-storage/async-storage';
import Feather from '@expo/vector-icons/Feather';
import { createAudioPlayer } from 'expo-audio';
import { Image } from 'expo-image';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCloudVoice } from '@/hooks/use-cloud-voice';
import { logEvent } from '@/lib/analytics';
import { CLOUD_VOICE_PROMO_KEY, koreaDay, parseCloudVoicePromoState, shouldShowCloudVoicePromo } from '@/lib/cloud-voice-promo';
import { dateLocale, translate as t } from '@/lib/i18n';
import { palette } from '@/constants/palette';

export function CloudVoicePromo({ loggedIn, blocked = false, onboardingJustFinished = false }: { loggedIn: boolean; blocked?: boolean; onboardingJustFinished?: boolean }) {
  const insets = useSafeAreaInsets();
  const cloud = useCloudVoice();
  const [visible, setVisible] = useState(false);
  const [playing, setPlaying] = useState(false);
  const player = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  const freeDate = useMemo(() => cloud.status?.free_until ? new Date(cloud.status.free_until).toLocaleDateString(dateLocale(), { month: 'long', day: 'numeric' }) : '', [cloud.status?.free_until]);

  useEffect(() => {
    let cancelled = false;
    if (!cloud.status || blocked) return;
    void AsyncStorage.getItem(CLOUD_VOICE_PROMO_KEY).then((raw) => {
      const now = Date.now();
      const promo = parseCloudVoicePromoState(raw);
      const show = shouldShowCloudVoicePromo({ loggedIn, available: cloud.status!.available, consent: cloud.status!.consent, enabled: cloud.enabled, freeUntil: cloud.status!.free_until, promo, today: koreaDay(now), now, otherModalOpen: blocked, onboardingJustFinished });
      if (!cancelled && show) {
        setVisible(true);
        void AsyncStorage.setItem(CLOUD_VOICE_PROMO_KEY, JSON.stringify({ ...promo, lastShownDay: koreaDay(now) }));
        logEvent('cloud_voice_promo_shown', {});
      }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [blocked, cloud.enabled, cloud.status, loggedIn, onboardingJustFinished]);

  useEffect(() => () => { try { player.current?.remove(); } catch {} }, []);
  useEffect(() => {
    if (cloud.enabled && cloud.status?.consent === 'granted') setVisible(false);
  }, [cloud.enabled, cloud.status?.consent]);
  const close = () => { setVisible(false); logEvent('cloud_voice_promo_close', {}); };
  const toggleSample = () => {
    if (playing) { player.current?.pause(); setPlaying(false); return; }
    if (!player.current) player.current = createAudioPlayer(require('@/assets/audio/cloud-voice-sample.m4a'));
    player.current.play(); setPlaying(true);
  };
  const dismissForever = async () => {
    const raw = await AsyncStorage.getItem(CLOUD_VOICE_PROMO_KEY).catch(() => null);
    await AsyncStorage.setItem(CLOUD_VOICE_PROMO_KEY, JSON.stringify({ ...parseCloudVoicePromoState(raw), dismissedForever: true })).catch(() => undefined);
    logEvent('cloud_voice_promo_dismiss_forever', {}); setVisible(false);
  };
  // 팝업을 먼저 닫고 동의 시트를 띄운다 — iOS 는 모달 위에 모달을 올리지 못한다.
  const turnOn = async () => {
    logEvent('cloud_voice_promo_enable', {});
    setVisible(false);
    await new Promise((resolve) => setTimeout(resolve, 350));
    await cloud.enable('promo');
  };

  return <>
    <Modal visible={visible} animationType="fade" onRequestClose={close} statusBarTranslucent>
      <View style={[styles.screen, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 20 }]}>
        <Pressable style={styles.close} onPress={close} accessibilityLabel={t('common.close')}><Feather name="x" size={22} color={palette.text} /></Pressable>
        <View style={styles.center}>
          <Text style={styles.badge}>{t('cloudVoice.promoBadge', { date: freeDate })}</Text>
          <Text style={styles.title}>{t('cloudVoice.promoTitle')}</Text>
          <Text style={styles.body}>{t('cloudVoice.promoBody')}</Text>
          <View style={styles.artRow}>
            <Image source={require('@/assets/images/mascot-reading.png')} style={styles.mascot} contentFit="contain" />
            <Pressable style={styles.sample} onPress={toggleSample}><Feather name={playing ? 'pause' : 'play'} size={16} color={palette.flameDeep} /><Text style={styles.sampleText}>{t(playing ? 'cloudVoice.sampleStop' : 'cloudVoice.samplePlay')}</Text></Pressable>
          </View>
        </View>
        <Pressable style={styles.enable} onPress={() => void turnOn()}><Text style={styles.enableText}>{t('cloudVoice.enable')}</Text></Pressable>
        <Pressable style={styles.dismiss} onPress={() => void dismissForever()}><Text style={styles.dismissText}>{t('cloudVoice.dismissForever')}</Text></Pressable>
      </View>
    </Modal>
    {cloud.consentSheet}
  </>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 24, backgroundColor: palette.flameSoft },
  close: { alignSelf: 'flex-end', width: 44, height: 44, borderRadius: 22, backgroundColor: palette.bg, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  badge: { backgroundColor: palette.bg, color: palette.flameDeep, borderRadius: 9999, paddingHorizontal: 16, paddingVertical: 8, fontSize: 13, fontWeight: '800' },
  title: { color: palette.text, fontSize: 30, lineHeight: 39, fontWeight: '900', textAlign: 'center', marginTop: 20 },
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
