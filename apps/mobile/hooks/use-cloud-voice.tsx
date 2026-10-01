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
  const [enabled, setEnabled] = useState(false);
  const [document, setDocument] = useState<ConsentEntryDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const sourceRef = useRef<'promo' | 'settings'>('settings');

  const refresh = useCallback(async () => {
    const [stored, next] = await Promise.all([loadCloudVoiceEnabled(), api.getCloudVoiceStatus()]);
    setEnabled(stored);
    setStatus(next);
    return next;
  }, []);

  useEffect(() => { void refresh().catch(() => undefined); }, [refresh]);

  const finishEnable = useCallback(async (source: 'promo' | 'settings') => {
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
      setDocument(cloudDocument);
      return false;
    } catch { return false; } finally { setBusy(false); }
  }, [busy, finishEnable]);

  const decide = useCallback(async (granted: boolean) => {
    if (!document || busy) return;
    setBusy(true);
    try {
      await api.recordConsent(document.id, granted ? 'granted' : 'declined');
      setDocument(null);
      if (granted) await finishEnable(sourceRef.current);
      else {
        await saveCloudVoiceEnabled(false);
        setEnabled(false);
        setStatus((current) => current ? { ...current, consent: 'denied' } : current);
      }
    } finally { setBusy(false); }
  }, [busy, document, finishEnable]);

  const disable = useCallback(async () => {
    await saveCloudVoiceEnabled(false);
    setEnabled(false);
  }, []);

  const consentSheet = (
    <>
    <Modal visible={!!document} transparent animationType="slide" onRequestClose={() => !busy && setDocument(null)}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <Text style={styles.title}>{document?.title}</Text>
          <ScrollView style={styles.body}><Markdown source={consentBodyWithoutTitle(document?.body ?? '')} /></ScrollView>
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

  return { status, enabled, busy, refresh, enable, disable, consentSheet };
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: palette.scrim, justifyContent: 'flex-end' },
  toast: { position: 'absolute', left: 24, right: 24, borderRadius: 14, backgroundColor: palette.text, paddingVertical: 13, paddingHorizontal: 16, alignItems: 'center' },
  toastText: { color: palette.onAccent, fontSize: 14, fontWeight: '700' },
  sheet: { maxHeight: '82%', backgroundColor: palette.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20 },
  title: { color: palette.text, fontSize: 21, fontWeight: '900', marginBottom: 12 },
  body: { maxHeight: 360 },
  primary: { height: 54, borderRadius: 9999, backgroundColor: palette.flame, alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  primaryText: { color: palette.onAccent, fontSize: 16, fontWeight: '800' },
  ghost: { height: 48, alignItems: 'center', justifyContent: 'center' },
  ghostText: { color: palette.textMuted, fontSize: 14, fontWeight: '700' },
});
