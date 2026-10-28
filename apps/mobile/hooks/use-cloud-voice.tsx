import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Markdown } from '@/components/markdown';
import { palette } from '@/constants/palette';
import { logEvent } from '@/lib/analytics';
import { api, type ConsentEntryDocument } from '@/lib/api';
import { consentBodyWithoutTitle, loadCloudVoiceEnabled, saveCloudVoiceEnabled, type CloudVoiceStatus } from '@/lib/reading/cloud-voice';
import { translate as t } from '@/lib/i18n';

export function useCloudVoice() {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState(false);
  const [status, setStatus] = useState<CloudVoiceStatus | null>(null);
  /** 상태를 못 받아 왔다 — 기다리지 말고 모르는 채로 진행하라는 신호(공지 포스터가 쓴다). */
  const [statusFailed, setStatusFailed] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [document, setDocument] = useState<ConsentEntryDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [decideFailed, setDecideFailed] = useState(false);
  const sourceRef = useRef<'promo' | 'settings' | 'first_reading'>('settings');
  /** 첫 리딩 동의를 기다리는 쪽(askFirstReading)을 깨우는 함수. */
  const settleRef = useRef<(() => void) | null>(null);
  const settle = useCallback(() => { settleRef.current?.(); settleRef.current = null; }, []);

  const refresh = useCallback(async () => {
    const [stored, next] = await Promise.all([loadCloudVoiceEnabled(), api.getCloudVoiceStatus()]);
    setEnabled(stored);
    setStatus(next);
    setStatusFailed(false);
    return next;
  }, []);

  useEffect(() => { void refresh().catch(() => setStatusFailed(true)); }, [refresh]);

  const finishEnable = useCallback(async (source: 'promo' | 'settings' | 'first_reading') => {
    await saveCloudVoiceEnabled(true);
    setEnabled(true);
    setStatus((current) => current ? { ...current, consent: 'granted' } : current);
    logEvent('cloud_voice_enabled', { source });
    setToast(true);
    setTimeout(() => setToast(false), 2200);
    return true;
  }, []);

  const enable = useCallback(async (source: 'promo' | 'settings'): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    sourceRef.current = source;
    try {
      const current = await api.getCloudVoiceStatus();
      setStatus(current);
      if (!current.available) return false;
      if (current.consent === 'granted') return await finishEnable(source);
      const entry = await api.consentEntry();
      const cloudDocument = entry.documents.find((item) => item.type === 'cloud_voice') ?? null;
      if (!cloudDocument) return false;
      setDecideFailed(false);
      setDocument(cloudDocument);
      return false;
    } catch { return false; } finally { setBusy(false); }
  }, [busy, finishEnable]);

  /**
   * 무료 배우의 대본 첫 리딩을 시작하기 전(SOMA-917): 그 리딩이 무료 고품질이고 동의가 아직 결정되지 않았으면 기존 동의 창을 띄워
   * 결정이 날 때까지 기다린다. 동의하든 거절하든 끝나면 돌아오고, 호출한 쪽은 그대로 리딩을 시작한다. 이미 결정했거나(거절 포함)
   * 끈 사람, 무료 첫 리딩이 아닌 경우, 상태를 못 받은 경우에는 묻지 않고 바로 돌아온다.
   */
  const askFirstReading = useCallback(async (scriptId: string): Promise<void> => {
    try {
      if (!(await loadCloudVoiceEnabled())) return;
      const current = await api.getCloudVoiceStatus({ scriptId });
      if (current.reason !== 'first_reading' || current.consent !== 'undecided') return;
      const entry = await api.consentEntry();
      const cloudDocument = entry.documents.find((item) => item.type === 'cloud_voice') ?? null;
      if (!cloudDocument) return;
      sourceRef.current = 'first_reading';
      setDecideFailed(false);
      await new Promise<void>((resolve) => {
        settleRef.current = resolve;
        setDocument(cloudDocument);
      });
    } catch { /* 물어보지 못해도 리딩은 기기 목소리로 시작한다 */ }
  }, []);

  const decide = useCallback(async (granted: boolean) => {
    if (!document || busy) return;
    setBusy(true);
    setDecideFailed(false);
    try {
      await api.recordConsent(document.id, granted ? 'granted' : 'declined');
      setDocument(null);
      settle();
      if (granted) await finishEnable(sourceRef.current);
      else {
        await saveCloudVoiceEnabled(false);
        setEnabled(false);
        setStatus((current) => current ? { ...current, consent: 'denied' } : current);
      }
    } catch { setDecideFailed(true); } finally { setBusy(false); }
  }, [busy, document, finishEnable, settle]);

  const disable = useCallback(async () => {
    await saveCloudVoiceEnabled(false);
    setEnabled(false);
  }, []);

  const consentSheet = (
    <>
    <Modal visible={!!document} transparent animationType="fade" onRequestClose={() => { if (!busy) { setDocument(null); settle(); } }}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{document?.title}</Text>
          <ScrollView style={styles.body}><Markdown source={consentBodyWithoutTitle(document?.body ?? '')} /></ScrollView>
          {decideFailed && <Text style={styles.error}>{t('consent.agreeFail')}</Text>}
          <Pressable style={styles.primary} disabled={busy} onPress={() => void decide(true)}><Text style={styles.primaryText}>{t('cloudVoice.consentAgree')}</Text></Pressable>
          <Pressable style={styles.ghost} disabled={busy} onPress={() => void decide(false)}><Text style={styles.ghostText}>{t('cloudVoice.consentDecline')}</Text></Pressable>
        </View>
      </View>
    </Modal>
    {toast && (
      <View pointerEvents="none" style={[styles.toast, { bottom: insets.bottom + 96 }]}>
        <Text style={styles.toastText}>{t('cloudVoice.enabledToast')}</Text>
      </View>
    )}
    </>
  );

  return { status, statusFailed, enabled, busy, refresh, enable, disable, askFirstReading, consentSheet };
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: palette.scrim, justifyContent: 'center', paddingHorizontal: 16 },
  toast: { position: 'absolute', left: 24, right: 24, borderRadius: 14, backgroundColor: palette.text, paddingVertical: 13, paddingHorizontal: 16, alignItems: 'center' },
  toastText: { color: palette.onAccent, fontSize: 14, fontWeight: '700' },
  sheet: { maxHeight: '82%', backgroundColor: palette.card, borderRadius: 22, padding: 20 },
  title: { color: palette.text, fontSize: 21, fontWeight: '900', marginBottom: 12 },
  body: { maxHeight: 360 },
  error: { color: palette.danger, textAlign: 'center', marginTop: 12 },
  primary: { height: 54, borderRadius: 9999, backgroundColor: palette.flame, alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  primaryText: { color: palette.onAccent, fontSize: 16, fontWeight: '800' },
  ghost: { height: 48, alignItems: 'center', justifyContent: 'center' },
  ghostText: { color: palette.textMuted, fontSize: 14, fontWeight: '700' },
});
