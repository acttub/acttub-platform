import Feather from '@expo/vector-icons/Feather';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';

import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { ReadingNoScript } from '@/components/reading/no-script';
import { AnchoredMenu, MENU_ITEM_HEIGHT, MENU_PAD, MenuItem, pt, type MenuAnchor } from '@/components/ui/anchored-menu';
import { PrimaryButton } from '@/components/ui/buttons';
import { CtaBar } from '@/components/ui/cta-bar';
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
import {
  genderOfVoice,
  isKnownPreset,
  recommendedVoice,
  shownVoices,
  switchGender,
  voiceChanges,
  voiceChoice,
  voiceName,
  VOICES_BY_GENDER,
  type VoiceGender,
  type VoicePreset,
} from '@/lib/reading/voices';
import type { ScriptCharacter } from '@/lib/reading/types';
import { translate as t } from '@/lib/i18n';

/**
 * 목소리 정하기(R3, reading.cast). 대본 등록의 마지막 단계이고 R4 ⋯ 「목소리 바꾸기」로도 온다. 대본의 모든 배역에
 * 목소리(자동 + M1~M5·F1~F5)를 정하고 [저장] 한 번으로 대본에 남긴다(PATCH voice_preset). 내 배역은 연습할 때 고른다.
 * 미리 듣기는 연습 때 읽을 엔진으로 — 고품질 목소리를 쓰는 중이면 앱에 넣은 Gemini 샘플, 아니면 기기 목소리(Supertonic).
 */
const NO_CHARACTERS: ScriptCharacter[] = [];
const genderOf = (voice: VoicePreset | undefined, known?: 'm' | 'f' | null): VoiceGender => (voice ? genderOfVoice(voice) : known ?? 'f');
const MENU_LABEL_HEIGHT = 32;

export default function ReadingRoles() {
  const router = useRouter();
  const { alert, dialog } = useAppDialog();
  const fromNew = useLocalSearchParams<{ from?: string }>().from === 'new';
  const script = getCurrent();
  const characters = script?.characters ?? NO_CHARACTERS;
  /** 이 화면에서 고친 값만(배역 id → 프리셋, null=자동). [저장] 전에는 대본에 없다. */
  const [chosen, setChosen] = useState<Record<string, string | null>>({});
  const [menu, setMenu] = useState<{ characterId: string; anchor?: MenuAnchor } | null>(null);
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

  if (!script) return <ReadingNoScript />;

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
          void alert({ title: t('reading.voicePreviewFailedTitle'), message: t('reading.voicePreviewNotReady') });
        }
      } else {
        await engine.ensureReady(() => {});
        if (current()) await engine.preview(preset);
      }
    } catch {
      if (current()) void alert({ title: t('reading.voicePreviewFailedTitle'), message: t('reading.voicePreviewNotReady') });
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

  const choose = (characterId: string, patch: Record<string, VoicePreset | null>) => {
    const next = { ...chosen, ...patch };
    setChosen(next);
    const heard = shownVoices(characters, next)[characterId];
    if (heard) void preview(characterId, heard);
  };

  const pickVoice = (characterId: string, preset: VoicePreset) => {
    choose(characterId, voiceChoice(characters, chosen, characterId, preset));
    setMenu(null);
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
        void alert({ title: t('reading.voiceSaveFailedTitle'), message: t('reading.voiceSaveFailed') });
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


  const menuFor = menu ? effective.find((c) => c.id === menu.characterId) : undefined;
  const menuVoice = menuFor ? assigned[menuFor.id] : undefined;
  const menuGender = menuFor ? genderOf(menuVoice, menuFor.gender) : null;

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.heading}>
          <Text style={styles.step}>{t('reading.voicesStep')}</Text>
          <Text style={styles.title}>{t('reading.voicesHeading')}</Text>
        </View>

        <View style={styles.scriptCard}>
          <Feather name="file-text" size={22} color={palette.textSub} />
          <View style={styles.flex}>
            <Text style={styles.scriptTitle} numberOfLines={1}>{script.title}</Text>
            <Text style={styles.meta}>
              {t('reading.voicesScriptMeta', { characters: characters.length, dialogues: script.dialogueCount })}
            </Text>
          </View>
          <Pressable hitSlop={8} onPress={() => router.push('/reading/full')} accessibilityRole="button">
            <Text style={styles.viewAll}>{t('reading.viewAll')}</Text>
          </Pressable>
        </View>

        <View style={styles.sectionHead}>
          <Text style={styles.section}>{t('reading.voicesSection')}</Text>
          <Text style={styles.meta}>{t('reading.voicesNote')}</Text>
        </View>

        <View style={styles.list} ref={roleListTarget.ref} onLayout={roleListTarget.onLayout}>
          {effective.map((c) => {
            const playing = previewing === c.id;
            const open = menu?.characterId === c.id;
            const voice = isKnownPreset(c.voice_preset) ? c.voice_preset : assigned[c.id];
            const gender = t(genderOf(voice, c.gender) === 'm' ? 'reading.voiceGenderMale' : 'reading.voiceGenderFemale');
            return (
              <View key={c.id} style={styles.row}>
                <View style={styles.flex}>
                  <Text style={styles.rowName} numberOfLines={1}>{c.name}</Text>
                  <Text style={playing ? styles.previewing : styles.meta}>
                    {playing ? t('reading.voicePreviewing') : t('reading.voicesLines', { count: c.dialogue_count })}
                  </Text>
                </View>
                <Pressable
                  style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
                  onPress={() => choose(c.id, switchGender(characters, chosen, c.id))}
                  accessibilityRole="button"
                  accessibilityLabel={t('reading.voiceGenderToggle', { gender })}
                  ph-label="reading_voice_gender">
                  <Text style={styles.pillText}>{gender}</Text>
                  <Feather name="repeat" size={14} color={palette.iconFaint} />
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.pill, open && styles.pillOpen, pressed && styles.pressed]}
                  onPress={(e: GestureResponderEvent) => setMenu(open ? null : { characterId: c.id, anchor: pt(e) })}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                  ph-label="reading_voice_menu">
                  <Text style={[styles.pillText, open && styles.pillTextOpen]}>{voiceName(voice)}</Text>
                  <Feather name="chevron-down" size={14} color={open ? palette.blueDeep : palette.iconFaint} />
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.play, playing && styles.playOn, pressed && styles.pressed]}
                  hitSlop={4}
                  accessibilityRole="button"
                  accessibilityLabel={t('reading.voicePreview')}
                  ph-label="reading_voice_preview"
                  onPress={() => togglePreview(c.id)}>
                  <Feather name={playing ? 'square' : 'volume-2'} size={18} color={playing ? palette.onAccent : palette.textSub} />
                </Pressable>
              </View>
            );
          })}
        </View>
      </ScrollView>

      <CtaBar>
        <View ref={saveTarget.ref} onLayout={saveTarget.onLayout}>
          <PrimaryButton label={t('common.save')} loading={saving} loadingLabel={t('loadingText.saving')} onPress={onSave} />
        </View>
      </CtaBar>

      {menuFor && menuGender && (
        <AnchoredMenu
          anchor={menu?.anchor}
          width={216}
          estimatedHeight={MENU_LABEL_HEIGHT + MENU_ITEM_HEIGHT * VOICES_BY_GENDER[menuGender].length + MENU_PAD * 2}
          onClose={() => setMenu(null)}>
          <Text style={styles.menuLabel}>{t(menuGender === 'm' ? 'reading.voicesMale' : 'reading.voicesFemale')}</Text>
          {VOICES_BY_GENDER[menuGender].map((p) => (
            <MenuItem
              key={p}
              label={voiceName(p)}
              selected={p === menuVoice}
              badge={p === recommendedVoice(characters, chosen, menuFor.id, menuGender) ? t('reading.voiceRecommendedBadge') : undefined}
              onPress={() => pickVoice(menuFor.id, p)}
            />
          ))}
        </AnchoredMenu>
      )}

      {dialog}
      {tutorialGuide.element}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  flex: { flex: 1, gap: space[1] },
  content: { paddingHorizontal: space.gutter, paddingTop: space[3], paddingBottom: space[6], gap: space[6] },
  heading: { gap: space[1] },
  step: { ...type.captionBold, color: palette.blueDeep },
  title: { ...type.title2, color: palette.text },
  scriptCard: { flexDirection: 'row', alignItems: 'center', gap: space[3], backgroundColor: palette.bgSubtle, borderRadius: radius.lg, padding: space[4] },
  scriptTitle: { ...type.body1Bold, color: palette.text },
  meta: { ...type.caption, color: palette.textMeta },
  previewing: { ...type.captionBold, color: palette.blueDeep },
  viewAll: { ...type.captionBold, color: palette.blueDeep },
  sectionHead: { gap: space[1], marginBottom: -space[3] },
  section: { ...type.headline, color: palette.text },
  list: { gap: space[3] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2], borderWidth: 1, borderColor: palette.border, borderRadius: radius.lg, padding: space[4] },
  rowName: { ...type.body1Bold, color: palette.text },
  pill: { flexDirection: 'row', alignItems: 'center', gap: space[1], height: 32, paddingHorizontal: space[3], borderRadius: radius.md, backgroundColor: palette.bgSoft },
  pillOpen: { backgroundColor: palette.blueSoft, borderWidth: 1.5, borderColor: palette.blue, paddingHorizontal: space[3] - 1.5 },
  pillText: { ...type.captionBold, color: palette.textSub },
  pillTextOpen: { color: palette.blueDeep },
  play: { width: 32, height: 32, borderRadius: radius.full, backgroundColor: palette.bgSoft, alignItems: 'center', justifyContent: 'center' },
  playOn: { backgroundColor: palette.blue },
  pressed: { opacity: 0.7 },
  menuLabel: { ...type.caption, color: palette.textMeta, height: MENU_LABEL_HEIGHT, paddingHorizontal: space[4], paddingTop: space[2] },
});
