import Feather from '@expo/vector-icons/Feather';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { PrimaryButton } from '@/components/ui/buttons';
import { useAppDialog } from '@/components/app-dialog';
import { useSpotlightTarget } from '@/hooks/use-spotlight-target';
import { useTutorialSpotlight } from '@/hooks/use-tutorial-spotlight';
import { api } from '@/lib/api';
import { TARGET } from '@/lib/spotlight-targets';
import { afterVoicesSaved, currentTutorial } from '@/lib/tutorial';
import { loadCloudVoiceEnabled, shouldUseCloudVoice } from '@/lib/reading/cloud-voice';
import { getCurrent, updateScriptMeta } from '@/lib/reading/store';
import * as engine from '@/lib/reading/tts/engine';
import { activeVariant, assetsPresent } from '@/lib/reading/tts/assets';
import { cloudVoiceSampleUri } from '@/lib/reading/voice-samples';
import { exampleLineUri, loadExampleAudio } from '@/lib/reading/example-audio-runtime';
import { autoVoiceOf, isKnownPreset, shownVoices, voiceChanges, voiceLabel, voiceName, type VoicePreset } from '@/lib/reading/voices';
import type { ScriptCharacter } from '@/lib/reading/types';
import { translate as t } from '@/lib/i18n';

/**
 * 목소리 정하기(R3, reading.cast). 대본 등록의 마지막 단계이고 R4 ⋯ 「목소리 바꾸기」로도 온다. 대본의 모든 배역에
 * 목소리(자동 + M1~M5·F1~F5)를 정하고 [저장] 한 번으로 대본에 남긴다(PATCH voice_preset). 내 배역은 연습할 때 고른다.
 * 미리 듣기는 연습 때 읽을 엔진으로 — 고품질 목소리를 쓰는 중이면 앱에 넣은 Gemini 샘플, 아니면 기기 목소리(Supertonic).
 */
const NO_CHARACTERS: ScriptCharacter[] = [];
// 나이 순서(젊은 → 노년). 이름은 음높이로 정한 느낌이다(SOMA-670, lib/reading/voices PREFERENCE 와 같은 판단).
const MALE: VoicePreset[] = ['M1', 'M4', 'M3', 'M2', 'M5'];
const FEMALE: VoicePreset[] = ['F2', 'F4', 'F1', 'F3', 'F5'];

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
  const savingRef = useRef(false);
  /**
   * 미리 듣기 차례 번호. 멈춤·다른 미리 듣기·저장·화면 닫기마다 올린다 — 샘플·모델을 기다리는 동안 멈췄으면
   * 기다림이 끝나도 틀지 않는다(engine.play 는 앞선 stop 을 모른다).
   */
  const previewRun = useRef(0);
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
  // 예시에서 온 대본(sample)은 미리 만든 음성으로 읽을 수 있어 받지 않는다(example-audio). 서버 답을 기다리면 받기와 엇갈려 입력 경로로 정한다.
  const fromSample = script?.source === 'sample';
  useEffect(() => {
    if (!fromSample) void engine.prefetchIfWifi();
    const run = previewRun;
    return () => {
      run.current += 1;
      engine.stop();
    };
  }, [fromSample]);

  // 앱을 내리면 미리 듣기를 멈춘다 — 리딩처럼 화면 밖에서는 소리를 내지 않는다(SOMA-670).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        previewRun.current += 1;
        engine.stop();
        setPreviewing(null);
      }
    });
    return () => sub.remove();
  }, []);

  const effective = useMemo(
    () => characters.map((c) => (c.id in chosen ? { ...c, voice_preset: chosen[c.id] } : c)),
    [characters, chosen],
  );
  const assigned = useMemo(() => shownVoices(characters, chosen), [characters, chosen]);

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

  const stopPreview = () => {
    previewRun.current += 1;
    engine.stop();
  };

  const preview = async (characterId: string, preset: VoicePreset) => {
    stopPreview();
    const run = previewRun.current;
    const current = () => run === previewRun.current;
    setPreviewing(characterId);
    try {
      if (await cloudVoice) {
        const uri = await cloudVoiceSampleUri(preset);
        if (current()) await engine.play(uri);
      } else if (!engine.isReady() && !assetsPresent(activeVariant(), 'M1')) {
        // 모델이 없으면 미리 듣기 대신 안내한다 — 내려받기 확인은 연습 시작 때 받는다. 예시 대본이고 예시 목소리 그대로면
        // 그 배역의 첫 대사 음성을 들려준다.
        const uri = fromSample ? await exampleSampleUri(characterId, preset) : null;
        if (uri) {
          if (current()) await engine.play(uri);
        } else if (current()) {
          void alert({ title: t('reading.voicePreview'), message: t('reading.voiceNotReady') });
        }
      } else {
        await engine.ensureReady(() => {});
        if (current()) await engine.preview(preset);
      }
    } catch {
      if (current()) void alert({ title: t('reading.voicePreview'), message: t('reading.voiceNotReady') });
    } finally {
      if (current()) setPreviewing(null);
    }
  };

  /** 예시 음성으로 미리 듣기 — 그 배역의 예시 목소리와 같은 프리셋일 때 첫 대사 음성 파일. 아니면 null. */
  const exampleSampleUri = async (characterId: string, preset: VoicePreset): Promise<string | null> => {
    const name = characters.find((c) => c.id === characterId)?.name;
    const audio = await loadExampleAudio(script.id);
    if (!audio || !name || audio.voices[name] !== preset) return null;
    const index = script.lines.findIndex((l, i) => l.type === 'dialogue' && l.role === name && audio.lines.has(script.lineIds[i]));
    if (index < 0) return null;
    return exampleLineUri(audio, script.lineIds[index]).catch(() => null);
  };

  const togglePreview = (characterId: string) => {
    if (previewing === characterId) {
      stopPreview();
      setPreviewing(null);
      return;
    }
    const preset = assigned[characterId];
    if (preset) void preview(characterId, preset);
  };

  const choose = (characterId: string, value: VoicePreset | null) => {
    setChosen((prev) => ({ ...prev, [characterId]: value }));
    const heard = value ?? autoVoiceOf(characters, chosen, characterId);
    if (heard) void preview(characterId, heard);
  };

  // 목소리를 고르면 바꾸고 펼친 칸을 접는다.
  const pickVoice = (characterId: string, value: VoicePreset | null) => {
    choose(characterId, value);
    setSheetFor(null);
  };

  const onSave = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    stopPreview();
    setPreviewing(null);
    const changes = voiceChanges(characters, chosen);
    if (changes.length > 0) {
      setSaving(true);
      try {
        await updateScriptMeta(script.id, { characters: changes });
      } catch {
        savingRef.current = false;
        void alert({ title: t('reading.voiceLabel'), message: t('reading.voiceSaveFailed') });
        return;
      } finally {
        setSaving(false);
      }
    }
    const next = afterVoicesSaved(fromNew, currentTutorial());
    if (next === 'back') {
      router.back();
      return;
    }
    router.replace('/reading/detail');
    if (next === 'detail_then_range') router.push('/reading/range');
  };


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
            const open = sheetFor === c.id;
            const value = isKnownPreset(c.voice_preset) ? c.voice_preset : null;
            return (
              <View key={c.id} style={styles.rowBox}>
              <View style={styles.row}>
                <View style={styles.rowInfo}>
                  <Text style={styles.rowName} numberOfLines={1}>{c.name}</Text>
                  <Text style={[styles.rowMeta, playing && styles.rowMetaPlaying]}>
                    {playing ? t('reading.voicePreviewing') : t('reading.voicesLines', { count: c.dialogue_count })}
                  </Text>
                </View>
                <Pressable style={styles.voiceChip} onPress={() => setSheetFor(open ? null : c.id)} accessibilityRole="button" accessibilityState={{ expanded: open }}>
                  <Text style={styles.voiceChipText}>
                    {voiceLabel(isKnownPreset(c.voice_preset) ? c.voice_preset : assigned[c.id])}
                  </Text>
                  <Feather name={open ? 'chevron-up' : 'chevron-down'} size={13} color={palette.blueDeep} />
                </Pressable>
                <Pressable
                  style={[styles.playBtn, playing && styles.playBtnOn]}
                  hitSlop={6}
                  accessibilityLabel={t('reading.voicePreview')}
                  onPress={() => togglePreview(c.id)}>
                  <Feather name={playing ? 'square' : 'volume-2'} size={14} color={playing ? '#fff' : palette.blueDeep} />
                </Pressable>
              </View>
              {open && (
                // 목소리 고르기 — 시트 대신 그 배역 줄 아래에 펼친다(SOMA-821). 고르면 접히고, 미리 듣기 버튼은 그대로 쓴다.
                <View style={styles.picker}>
                  <Pressable style={[styles.autoBtn, value === null && styles.chipOn]} onPress={() => pickVoice(c.id, null)}>
                    {value === null && <Feather name="check" size={15} color={palette.blueDeep} />}
                    <Text style={[styles.chipText, value === null && styles.chipTextOn]}>
                      {t('reading.voiceRecommended', { voice: voiceLabel(autoVoiceOf(characters, chosen, c.id)) })}
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
                          <Pressable key={p} style={[styles.chip, value === p && styles.chipOn]} onPress={() => pickVoice(c.id, p)}>
                            <Text style={[styles.chipText, value === p && styles.chipTextOn]}>{voiceName(p)}</Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  ))}
                </View>
              )}
              </View>
            );
          })}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <View ref={saveTarget.ref} onLayout={saveTarget.onLayout}>
          <PrimaryButton label={saving ? `${t('common.saving')}…` : t('common.save')} onPress={onSave} disabled={saving} />
        </View>
      </View>

      {dialog}
      {tutorialGuide.element}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  empty: { color: palette.textMeta, fontFamily: 'Pretendard', fontSize: 15 },
  content: { padding: 20, gap: 10 },
  step: { color: palette.blue, fontFamily: 'Pretendard-SemiBold', fontSize: 12, letterSpacing: 0.3 },
  title: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 22, marginTop: 2 },
  scriptCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: palette.blueSoft, borderRadius: 12, padding: 14, marginTop: 4 },
  scriptIcon: { width: 36, height: 36, borderRadius: 9, backgroundColor: palette.bg, alignItems: 'center', justifyContent: 'center' },
  scriptInfo: { flex: 1, gap: 2 },
  scriptTitle: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 16 },
  scriptMeta: { color: palette.textMeta, fontFamily: 'Pretendard', fontSize: 13 },
  viewAll: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  viewAllText: { color: palette.blueDeep, fontFamily: 'Pretendard-SemiBold', fontSize: 13 },
  section: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 15, marginTop: 10 },
  note: { color: palette.textMeta, fontFamily: 'Pretendard', fontSize: 12, marginTop: -6 },
  rowBox: { gap: 0 },
  picker: { gap: 8, marginTop: -2, padding: 14, borderColor: palette.border, borderWidth: 1, borderTopWidth: 0, borderBottomLeftRadius: 12, borderBottomRightRadius: 12, backgroundColor: palette.bg },
  list: { gap: 8, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: palette.bgSubtle, borderColor: palette.border, borderWidth: 1, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14 },
  rowInfo: { flex: 1, gap: 2 },
  rowName: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 16 },
  rowMeta: { color: palette.textMeta, fontFamily: 'Pretendard', fontSize: 12 },
  rowMetaPlaying: { color: palette.blue },
  voiceChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: palette.blueSoft, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  voiceChipText: { color: palette.blueDeep, fontFamily: 'Pretendard-SemiBold', fontSize: 12 },
  playBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: palette.blueSoft, alignItems: 'center', justifyContent: 'center' },
  playBtnOn: { backgroundColor: palette.blue },
  footer: { paddingHorizontal: 16, paddingTop: 12, borderTopColor: palette.border, borderTopWidth: 1, backgroundColor: palette.bg },
  primary: { backgroundColor: palette.blue, borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  primaryOff: { backgroundColor: palette.textDisabled },
  primaryText: { color: '#fff', fontFamily: 'Pretendard-Bold', fontSize: 16 },
  pill: { backgroundColor: palette.blue, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 11 },
  pillText: { color: '#fff', fontFamily: 'Pretendard-SemiBold', fontSize: 14 },
  autoBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderColor: palette.border, borderWidth: 1, borderRadius: 12, paddingVertical: 13, marginTop: 6 },
  group: { gap: 8, marginTop: 4 },
  groupLabel: { color: palette.textSub, fontFamily: 'Pretendard', fontSize: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexBasis: '31%', flexGrow: 1, alignItems: 'center', borderColor: palette.border, borderWidth: 1, borderRadius: 12, paddingVertical: 12 },
  chipOn: { backgroundColor: palette.blueSoft, borderColor: palette.blue },
  chipText: { color: palette.text, fontFamily: 'Pretendard-SemiBold', fontSize: 14 },
  chipTextOn: { color: palette.blueDeep, fontFamily: 'Pretendard-Bold' },
});
