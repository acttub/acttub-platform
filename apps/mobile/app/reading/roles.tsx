import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { useAppDialog } from '@/components/app-dialog';
import { useSpotlightTarget } from '@/hooks/use-spotlight-target';
import { useTutorialSpotlight } from '@/hooks/use-tutorial-spotlight';
import { TARGET } from '@/lib/spotlight-targets';
import { scriptErrorMessage } from '@/lib/reading/script-errors';
import { defaultMyCharacterIds } from '@/lib/reading/session-plan';
import { getCurrent, updateCurrent, updateScriptMeta } from '@/lib/reading/store';
import * as engine from '@/lib/reading/tts/engine';
import { assetsPresent } from '@/lib/reading/tts/assets';
import { VOICE_PRESETS, assignVoices, isKnownPreset, normalizePresetValue, type VoicePreset } from '@/lib/reading/voices';
import { translate as t } from '@/lib/i18n';

/**
 * 배역 선택(R02, reading.cast). 내 배역은 하나 이상이고 기본 선택은 마지막 회차의 내 배역이다. 상대역마다
 * 목소리 드롭다운(자동 + M1~M5·F1~F5)과 미리 듣기가 있고, 고른 값은 대본에 저장돼(PATCH voice_preset) 다음
 * 회차도 같다. 저장이 실패하면 이번 회차에서만 그 목소리로 읽고 다음에 다시 저장한다.
 */
export default function ReadingRoles() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { alert, sheet, dialog } = useAppDialog();
  const script = getCurrent();
  const [selected, setSelected] = useState<string[]>(() =>
    script ? defaultMyCharacterIds({ last_session: script.lastSession, characters: script.characters }) : [],
  );
  /** 저장에 실패한 목소리 — 이번 회차에서만 쓴다. */
  const [overrides, setOverrides] = useState<Record<string, string | null>>({});
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [characters, setCharacters] = useState(script?.characters ?? []);
  const roleListTarget = useSpotlightTarget(TARGET.readingRoleList);
  const roleStartTarget = useSpotlightTarget(TARGET.readingRoleStart);
  const tutorialGuide = useTutorialSpotlight('readingRoles', { ready: !!script });

  useEffect(() => {
    if (script) setCharacters(script.characters);
  }, [script]);

  const effective = useMemo(
    () => characters.map((c) => ({ ...c, voice_preset: c.id in overrides ? overrides[c.id] : c.voice_preset })),
    [characters, overrides],
  );
  const assigned = useMemo(() => assignVoices(effective, selected), [effective, selected]);
  const single = characters.length === 1;

  if (!script) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={styles.empty}>{t('reading.noScript')}</Text>
        <Pressable style={styles.pill} onPress={() => router.replace('/reading/new')}>
          <Text style={styles.pillText}>대본 넣기로</Text>
        </Pressable>
      </View>
    );
  }

  const toggle = (id: string) => {
    if (single) return;
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const setVoice = async (characterId: string, value: string | null) => {
    const preset = normalizePresetValue(value);
    setOverrides((prev) => ({ ...prev, [characterId]: preset }));
    try {
      const detail = await updateScriptMeta(script.id, { characters: [{ id: characterId, voice_preset: preset }] });
      setCharacters(detail.characters);
      setOverrides((prev) => {
        const next = { ...prev };
        delete next[characterId];
        return next;
      });
    } catch (e) {
      // 이번 회차에서만 그 목소리로 읽고 다음 진입 때 다시 저장한다.
      void alert({ title: t('reading.voiceLabel'), message: `${t('reading.voiceSaveFailed')}\n${scriptErrorMessage(e)}` });
    }
  };

  const pickVoice = (characterId: string, currentValue: string | null) =>
    void sheet({
      title: t('reading.voiceLabel'),
      actions: [
        { label: `${t('reading.voiceAuto')}${currentValue === null ? ' ✓' : ''}`, onPress: () => void setVoice(characterId, null) },
        ...VOICE_PRESETS.map((p) => ({ label: `${p}${currentValue === p ? ' ✓' : ''}`, onPress: () => void setVoice(characterId, p) })),
      ],
    });

  const preview = async (characterId: string) => {
    const preset: VoicePreset = assigned[characterId] ?? 'F1';
    if (previewing) return;
    setPreviewing(characterId);
    try {
      if (!engine.isReady() && !assetsPresent('fp32', 'M1')) {
        // 모델이 없으면 미리 듣기 대신 안내한다 — 내려받기 확인은 시작 화면이 받는다.
        void alert({ title: t('reading.voicePreview'), message: t('reading.voiceNotReady') });
        return;
      }
      await engine.ensureReady(() => {});
      await engine.preview(preset);
    } catch {
      void alert({ title: t('reading.voicePreview'), message: t('reading.voiceNotReady') });
    } finally {
      setPreviewing(null);
    }
  };

  const onStart = async () => {
    if (selected.length < 1) return;
    const myRoles = characters.filter((c) => selected.includes(c.id)).map((c) => c.name);
    await updateCurrent({ myRoles, characters: effective });
    router.replace('/reading/range');
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.step}>STEP 2 · 배역 선택</Text>
        <Text style={styles.title}>{t('reading.rolesHeading')}</Text>
        <Text style={styles.sub}>{single ? t('reading.singleRoleNote') : t('reading.rolesSub')}</Text>

        <View style={styles.scriptCard}>
          <View style={styles.scriptIcon}>
            <Feather name="file-text" size={16} color={palette.blue} />
          </View>
          <View>
            <Text style={styles.scriptTitle}>{script.title}</Text>
            <Text style={styles.scriptMeta}>배역 {characters.length}명 · 대사 {script.dialogueCount}개</Text>
          </View>
        </View>

        <View style={styles.list} ref={roleListTarget.ref} onLayout={roleListTarget.onLayout}>
          {effective.map((c) => {
            const on = selected.includes(c.id);
            const voice = assigned[c.id];
            const fixed = isKnownPreset(c.voice_preset);
            return (
              <View key={c.id} style={[styles.roleRow, on && styles.roleRowOn]}>
                <Pressable style={styles.roleMain} onPress={() => toggle(c.id)}>
                  <View style={styles.roleInfo}>
                    <Text style={[styles.roleName, on && styles.roleNameOn]}>{c.name}</Text>
                    <Text style={styles.roleDesc}>
                      {on ? t('reading.pickRole') : `${t('reading.dialogueCount', { count: c.dialogue_count })} · ${fixed ? c.voice_preset : `${t('reading.voiceAuto')} ${voice ?? ''}`}`}
                    </Text>
                  </View>
                  <View style={[styles.check, on && styles.checkOn]}>
                    {on ? <Feather name="check" size={14} color="#fff" /> : null}
                  </View>
                </Pressable>
                {!on && (
                  <View style={styles.voiceRow}>
                    <Pressable style={styles.voiceBtn} onPress={() => pickVoice(c.id, fixed ? c.voice_preset : null)}>
                      <Feather name="user" size={13} color={palette.blueDeep} />
                      <Text style={styles.voiceText}>
                        {t('reading.voiceLabel')} · {fixed ? c.voice_preset : `${t('reading.voiceAuto')} (${voice ?? '-'})`}
                      </Text>
                      <Feather name="chevron-down" size={13} color={palette.blueDeep} />
                    </Pressable>
                    <Pressable style={[styles.voiceBtn, previewing === c.id && styles.voiceBtnBusy]} onPress={() => void preview(c.id)}>
                      <Feather name="volume-2" size={13} color={palette.blueDeep} />
                      <Text style={styles.voiceText}>{t('reading.voicePreview')}</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Pressable
          ref={roleStartTarget.ref}
          onLayout={roleStartTarget.onLayout}
          style={[styles.primary, selected.length < 1 && styles.primaryOff]}
          onPress={onStart}
          disabled={selected.length < 1}>
          <Text style={styles.primaryText}>
            {selected.length < 1 ? t('reading.pickRoleFirst') : t('reading.startWithRoles', { count: selected.length })}
          </Text>
        </Pressable>
      </View>
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
  sub: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 13, lineHeight: 20, marginBottom: 4 },
  scriptCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: palette.blueMist, borderColor: palette.blueLine, borderWidth: 1, borderRadius: 12, padding: 14 },
  scriptIcon: { width: 36, height: 36, borderRadius: 9, backgroundColor: palette.blueSoft, alignItems: 'center', justifyContent: 'center' },
  scriptTitle: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 16 },
  scriptMeta: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 13 },
  list: { gap: 10, marginTop: 6 },
  roleRow: { backgroundColor: palette.bgSubtle, borderColor: palette.border, borderWidth: 1, borderRadius: 12, padding: 14, gap: 10 },
  roleRowOn: { backgroundColor: palette.blueSoft, borderColor: palette.blue },
  roleMain: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  roleInfo: { gap: 3, flex: 1 },
  roleName: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 16 },
  roleNameOn: { color: palette.blueDeep },
  roleDesc: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 13 },
  check: { width: 24, height: 24, borderRadius: 12, borderColor: palette.checkOff, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: palette.blue, borderColor: palette.blue },
  voiceRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  voiceBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: palette.blueSoft, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  voiceBtnBusy: { opacity: 0.5 },
  voiceText: { color: palette.blueDeep, fontFamily: 'Pretendard-SemiBold', fontSize: 12 },
  footer: { padding: 16, borderTopColor: palette.borderSoft, borderTopWidth: 1, backgroundColor: palette.bg },
  primary: { backgroundColor: palette.blue, borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  primaryOff: { backgroundColor: palette.checkOff },
  primaryText: { color: '#fff', fontFamily: 'Pretendard-Bold', fontSize: 16 },
  pill: { backgroundColor: palette.blue, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 11 },
  pillText: { color: '#fff', fontFamily: 'Pretendard-SemiBold', fontSize: 14 },
});
