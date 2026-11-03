import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Markdown } from '@/components/markdown';
import { PrimaryButton, TextButton } from '@/components/ui/buttons';
import { Toast } from '@/components/ui/toast';
import { palette } from '@/constants/palette';
import { space } from '@/constants/tokens';
import { logEvent } from '@/lib/analytics';
import { api, type ConsentEntryDocument } from '@/lib/api';
import { afterHomeReady } from '@/lib/launch-splash';
import { consentBodyWithoutTitle, loadCloudVoiceEnabled, saveCloudVoiceEnabled, type CloudVoiceStatus } from '@/lib/reading/cloud-voice';
import { translate as t } from '@/lib/i18n';

/** deferUntilHomeReady — 홈에 뜨는 쪽(공지 포스터)은 홈 첫 데이터를 받은 뒤에 상태를 묻는다(lib/launch-splash afterHomeReady). */
export function useCloudVoice({ deferUntilHomeReady = false }: { deferUntilHomeReady?: boolean } = {}) {
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

  useEffect(() => {
    let cancelled = false;
    void (deferUntilHomeReady ? afterHomeReady() : Promise.resolve())
      .then(() => (cancelled ? undefined : refresh()))
      .catch(() => setStatusFailed(true));
    return () => { cancelled = true; };
  }, [refresh, deferUntilHomeReady]);

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
          <PrimaryButton label={t('cloudVoice.consentAgree')} loading={busy} style={styles.agree} onPress={() => void decide(true)} />
          <TextButton label={t('cloudVoice.consentDecline')} disabled={busy} onPress={() => void decide(false)} />
        </View>
      </View>
    </Modal>
    {toast && <Toast message={t('cloudVoice.enabledToast')} bottom={insets.bottom + 96} />}
    </>
  );

  return { status, statusFailed, enabled, busy, refresh, enable, disable, askFirstReading, consentSheet };
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: palette.scrim, justifyContent: 'center', paddingHorizontal: 16 },
  sheet: { maxHeight: '82%', backgroundColor: palette.bg, borderRadius: 22, padding: 20 },
  title: { color: palette.text, fontSize: 21, fontWeight: '900', marginBottom: 12 },
  body: { maxHeight: 360 },
  error: { color: palette.danger, textAlign: 'center', marginTop: 12 },
  agree: { marginTop: space[4] },
});
