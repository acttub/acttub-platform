import Feather from '@expo/vector-icons/Feather';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { useAppDialog } from '@/components/app-dialog';
import { useSpotlightTarget } from '@/hooks/use-spotlight-target';
import { useTutorialSpotlight } from '@/hooks/use-tutorial-spotlight';
import { api } from '@/lib/api';
import { TARGET } from '@/lib/spotlight-targets';
import { loadCloudVoiceEnabled, shouldUseCloudVoice } from '@/lib/reading/cloud-voice';
import { getCurrent, updateScriptMeta } from '@/lib/reading/store';
import * as engine from '@/lib/reading/tts/engine';
import { assetsPresent } from '@/lib/reading/tts/assets';
import { cloudVoiceSampleUri } from '@/lib/reading/voice-samples';
import { assignVoices, autoVoiceOf, isKnownPreset, voiceChanges, type VoicePreset } from '@/lib/reading/voices';
import type { ScriptCharacter } from '@/lib/reading/types';
import { translate as t } from '@/lib/i18n';

/**
 * 목소리 정하기(R3, reading.cast). 대본 등록의 마지막 단계이고 R4 ⋯ 「목소리 바꾸기」로도 온다. 대본의 모든 배역에
 * 목소리(자동 + M1~M5·F1~F5)를 정하고 [저장] 한 번으로 대본에 남긴다(PATCH voice_preset). 내 배역은 연습할 때 고른다.
 * 미리 듣기는 연습 때 읽을 엔진으로 — 고품질 목소리를 쓰는 중이면 앱에 넣은 Gemini 샘플, 아니면 기기 목소리(Supertonic).
 */
const NO_CHARACTERS: ScriptCharacter[] = [];
const MALE: VoicePreset[] = ['M1', 'M2', 'M3', 'M4', 'M5'];
const FEMALE: VoicePreset[] = ['F1', 'F2', 'F3', 'F4', 'F5'];

export default function ReadingRoles() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { alert, dialog } = useAppDialog();
  const fromNew = useLocalSearchParams<{ from?: string }>().from === 'new';
  const script = getCurrent();
  const characters = script?.characters ?? NO_CHARACTERS;
  /** 이 화면에서 고친 값만(배역 id → 프리셋, null=자동). [저장] 전에는 대본에 없다. */
  const [chosen, setChosen] = useState<Record<string, string | null>>({});
  const [sheetFor, setSheetFor] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // 연습 화면과 같은 판정 — 고품질 목소리로 읽을 사람은 그 목소리로 미리 듣는다.
  const [cloudVoice] = useState(() =>
    Promise.all([loadCloudVoiceEnabled(), api.getCloudVoiceStatus().catch(() => null)])
      .then(([enabled, status]) => shouldUseCloudVoice({ enabled, status }))
      .catch(() => false),
  );
  const roleListTarget = useSpotlightTarget(TARGET.readingRoleList);
  const saveTarget = useSpotlightTarget(TARGET.readingRoleStart);
  const tutorialGuide = useTutorialSpotlight('readingRoles', { ready: !!script });

  // Wi-Fi 면 상대역 목소리를 미리 받아 둔다 — 실행 화면에서 기다리지 않게. 화면을 막지 않고 실패도 알리지 않는다.
  useEffect(() => {
    void engine.prefetchIfWifi();
    return () => engine.stop();
  }, []);

  const effective = useMemo(
    () => characters.map((c) => (c.id in chosen ? { ...c, voice_preset: chosen[c.id] } : c)),
    [characters, chosen],
  );
  const assigned = useMemo(() => assignVoices(effective, []), [effective]);

  if (!script) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={styles.empty}>{t('reading.noScript')}</Text>
        <Pressable style={styles.pill} onPress={() => router.replace('/reading/new')}>
          <Text style={styles.pillText}>{t('reading.toNewScript')}</Text>
        </Pressable>
      </View>
    );
  }

  const preview = async (characterId: string, preset: VoicePreset) => {
    engine.stop();
    setPreviewing(characterId);
    try {
      if (await cloudVoice) {
        await engine.play(await cloudVoiceSampleUri(preset));
      } else if (!engine.isReady() && !assetsPresent('fp32', 'M1')) {
        // 모델이 없으면 미리 듣기 대신 안내한다 — 내려받기 확인은 연습 시작 때 받는다.
        void alert({ title: t('reading.voicePreview'), message: t('reading.voiceNotReady') });
      } else {
        await engine.ensureReady(() => {});
        await engine.preview(preset);
      }
    } catch {
      void alert({ title: t('reading.voicePreview'), message: t('reading.voiceNotReady') });
    } finally {
      setPreviewing((current) => (current === characterId ? null : current));
    }
  };

  const togglePreview = (characterId: string) => {
    if (previewing === characterId) {
      engine.stop();
      setPreviewing(null);
      return;
    }
    const preset = assigned[characterId];
    if (preset) void preview(characterId, preset);
  };

  const choose = (characterId: string, value: VoicePreset | null) => {
    setChosen((prev) => ({ ...prev, [characterId]: value }));
    const heard = value ?? autoVoiceOf(effective, characterId);
    if (heard) void preview(characterId, heard);
  };

  const onSave = async () => {
    const changes = voiceChanges(characters, chosen);
    if (changes.length > 0) {
      setSaving(true);
      try {
        await updateScriptMeta(script.id, { characters: changes });
      } catch {
        void alert({ title: t('reading.voiceLabel'), message: t('reading.voiceSaveFailed') });
        return;
      } finally {
        setSaving(false);
      }
    }
    engine.stop();
    if (fromNew) router.replace('/reading/detail');
    else router.back();
  };

  const sheetCharacter = effective.find((c) => c.id === sheetFor) ?? null;
  const sheetValue = sheetCharacter && isKnownPreset(sheetCharacter.voice_preset) ? sheetCharacter.voice_preset : null;

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.step}>{t('reading.voicesStep')}</Text>
        <Text style={styles.title}>{t('reading.voicesHeading')}</Text>

        <View style={styles.scriptCard}>
          <View style={styles.scriptIcon}>
            <Feather name="file-text" size={16} color={palette.blue} />
          </View>
          <View style={styles.scriptInfo}>
            <Text style={styles.scriptTitle} numberOfLines={1}>{script.title}</Text>
            <Text style={styles.scriptMeta}>
              {t('reading.voicesScriptMeta', { characters: characters.length, dialogues: script.dialogueCount })}
            </Text>
          </View>
          <Pressable style={styles.viewAll} hitSlop={8} onPress={() => router.push('/reading/full')}>
            <Text style={styles.viewAllText}>{t('reading.viewAll')}</Text>
            <Feather name="chevron-right" size={14} color={palette.blueDeep} />
          </Pressable>
        </View>

        <Text style={styles.section}>{t('reading.voicesSection')}</Text>
        <Text style={styles.note}>{t('reading.voicesNote')}</Text>

        <View style={styles.list} ref={roleListTarget.ref} onLayout={roleListTarget.onLayout}>
          {effective.map((c) => {
            const playing = previewing === c.id;
            return (
              <View key={c.id} style={styles.row}>
                <View style={styles.rowInfo}>
                  <Text style={styles.rowName} numberOfLines={1}>{c.name}</Text>
                  <Text style={[styles.rowMeta, playing && styles.rowMetaPlaying]}>
                    {playing ? t('reading.voicePreviewing') : t('reading.voicesLines', { count: c.dialogue_count })}
                  </Text>
                </View>
                <Pressable style={styles.voiceChip} onPress={() => setSheetFor(c.id)}>
                  <Text style={styles.voiceChipText}>
                    {isKnownPreset(c.voice_preset) ? c.voice_preset : t('reading.voiceAutoChip', { preset: assigned[c.id] ?? '-' })}
                  </Text>
                  <Feather name="chevron-down" size={13} color={palette.blueDeep} />
                </Pressable>
                <Pressable
                  style={[styles.playBtn, playing && styles.playBtnOn]}
                  hitSlop={6}
                  accessibilityLabel={t('reading.voicePreview')}
                  onPress={() => togglePreview(c.id)}>
                  <Feather name={playing ? 'square' : 'volume-2'} size={14} color={playing ? '#fff' : palette.blueDeep} />
                </Pressable>
              </View>
            );
          })}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Pressable
          ref={saveTarget.ref}
          onLayout={saveTarget.onLayout}
          style={[styles.primary, saving && styles.primaryOff]}
          onPress={onSave}
          disabled={saving}>
          <Text style={styles.primaryText}>{saving ? `${t('common.saving')}…` : t('common.save')}</Text>
        </Pressable>
      </View>

      <Modal transparent statusBarTranslucent visible={!!sheetCharacter} animationType="slide" onRequestClose={() => setSheetFor(null)}>
        <Pressable style={styles.backdrop} onPress={() => setSheetFor(null)}>
          {sheetCharacter && (
            <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} onPress={(e) => e.stopPropagation()}>
              <View style={styles.handle} />
              <Text style={styles.sheetTitle}>{t('reading.voiceSheetTitle', { name: sheetCharacter.name })}</Text>
              <Text style={styles.sheetNote}>{t('reading.voiceSheetNote')}</Text>
              <Pressable style={[styles.autoBtn, sheetValue === null && styles.chipOn]} onPress={() => choose(sheetCharacter.id, null)}>
                {sheetValue === null && <Feather name="check" size={15} color={palette.blueDeep} />}
                <Text style={[styles.chipText, sheetValue === null && styles.chipTextOn]}>
                  {t('reading.voiceAutoNow', { preset: autoVoiceOf(effective, sheetCharacter.id) ?? '-' })}
                </Text>
              </Pressable>
              {[
                { label: t('reading.voicesMale'), presets: MALE },
                { label: t('reading.voicesFemale'), presets: FEMALE },
              ].map((group) => (
                <View key={group.label} style={styles.group}>
                  <Text style={styles.groupLabel}>{group.label}</Text>
                  <View style={styles.chips}>
                    {group.presets.map((p) => (
                      <Pressable key={p} style={[styles.chip, sheetValue === p && styles.chipOn]} onPress={() => choose(sheetCharacter.id, p)}>
                        <Text style={[styles.chipText, sheetValue === p && styles.chipTextOn]}>{p}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ))}
              <Pressable style={[styles.primary, styles.sheetDone]} onPress={() => setSheetFor(null)}>
                <Text style={styles.primaryText}>{t('reading.voiceDone')}</Text>
              </Pressable>
            </Pressable>
          )}
        </Pressable>
      </Modal>
      {dialog}
      {tutorialGuide.element}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  empty: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 15 },
  content: { padding: 20, gap: 10 },
  step: { color: palette.blue, fontFamily: 'Pretendard-SemiBold', fontSize: 12, letterSpacing: 0.3 },
  title: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 22, marginTop: 2 },
  scriptCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: palette.blueMist, borderColor: palette.blueLine, borderWidth: 1, borderRadius: 12, padding: 14, marginTop: 4 },
  scriptIcon: { width: 36, height: 36, borderRadius: 9, backgroundColor: palette.blueSoft, alignItems: 'center', justifyContent: 'center' },
  scriptInfo: { flex: 1, gap: 2 },
  scriptTitle: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 16 },
  scriptMeta: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 13 },
  viewAll: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  viewAllText: { color: palette.blueDeep, fontFamily: 'Pretendard-SemiBold', fontSize: 13 },
  section: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 15, marginTop: 10 },
  note: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 12, marginTop: -6 },
  list: { gap: 8, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: palette.bgSubtle, borderColor: palette.border, borderWidth: 1, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14 },
  rowInfo: { flex: 1, gap: 2 },
  rowName: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 16 },
  rowMeta: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 12 },
  rowMetaPlaying: { color: palette.blue },
  voiceChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: palette.blueSoft, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  voiceChipText: { color: palette.blueDeep, fontFamily: 'Pretendard-SemiBold', fontSize: 12 },
  playBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: palette.blueSoft, alignItems: 'center', justifyContent: 'center' },
  playBtnOn: { backgroundColor: palette.blue },
  footer: { paddingHorizontal: 16, paddingTop: 12, borderTopColor: palette.borderSoft, borderTopWidth: 1, backgroundColor: palette.bg },
  primary: { backgroundColor: palette.blue, borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  primaryOff: { backgroundColor: palette.checkOff },
  primaryText: { color: '#fff', fontFamily: 'Pretendard-Bold', fontSize: 16 },
  pill: { backgroundColor: palette.blue, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 11 },
  pillText: { color: '#fff', fontFamily: 'Pretendard-SemiBold', fontSize: 14 },
  backdrop: { flex: 1, backgroundColor: palette.scrim, justifyContent: 'flex-end' },
  sheet: { backgroundColor: palette.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 10, gap: 10 },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: palette.border, marginBottom: 6 },
  sheetTitle: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 18 },
  sheetNote: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 13, marginTop: -4 },
  autoBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderColor: palette.border, borderWidth: 1, borderRadius: 12, paddingVertical: 13, marginTop: 6 },
  group: { gap: 8, marginTop: 4 },
  groupLabel: { color: palette.textDim, fontFamily: 'Pretendard', fontSize: 12 },
  chips: { flexDirection: 'row', gap: 8 },
  chip: { flex: 1, alignItems: 'center', borderColor: palette.border, borderWidth: 1, borderRadius: 12, paddingVertical: 12 },
  chipOn: { backgroundColor: palette.blueSoft, borderColor: palette.blue },
  chipText: { color: palette.text, fontFamily: 'Pretendard-SemiBold', fontSize: 14 },
  chipTextOn: { color: palette.blueDeep, fontFamily: 'Pretendard-Bold' },
  sheetDone: { marginTop: 10 },
});
