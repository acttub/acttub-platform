import { Stack } from 'expo-router';
import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KeyboardAwareScroll } from '@/components/keyboard-aware-scroll';
import { palette } from '@/constants/palette';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { api } from '@/lib/api';
import { logEvent } from '@/lib/analytics';
import { useAuth } from '@/lib/auth';
import { translate as t, translateList } from '@/lib/i18n';

type Gender = 'female' | 'male' | 'none';

/**
 * A0.2 프로필 설정 — 온보딩에서 배우 정보를 받는다(pen A0.2).
 *
 * 이름은 프로필 셋업, 성별·나이는 배우 전용 기억(gender·age)에 저장한다. 추구 방향·연기
 * 경력·최종 목표는 아직 저장할 서버 필드가 없어 계측만 한다(theory 칩과 같은 상태).
 * 이름만 필수 — 나머지는 비워도 시작할 수 있다.
 */
export default function ProfileNameScreen() {
  const { completeProfileSetup } = useAuth();
  const [name, setName] = useState('');
  const [gender, setGender] = useState<Gender | null>(null);
  const [birthYear, setBirthYear] = useState('');
  const [mediums, setMediums] = useState<string[]>([]);
  const [career, setCareer] = useState<number | null>(null);
  const [goal, setGoal] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keyboardHeight = useKeyboardHeight();

  const careers = translateList('profileName.careerOptions');
  const goals = translateList('profileName.goalOptions');

  const toggleMedium = (v: string) =>
    setMediums((prev) => (prev.includes(v) ? prev.filter((m) => m !== v) : [...prev, v]));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      // 저장되는 칸(성별·나이)은 프로필 셋업 전에 먼저 넣는다 — 셋업이 끝나면 화면이 떠난다.
      // 실패해도 온보딩을 막지 않는다(이름이 정본 게이트).
      if (gender === 'female' || gender === 'male') {
        await api.saveActorMemory('gender', gender === 'female' ? '여성' : '남성').catch(() => {});
      }
      if (birthYear.trim()) {
        await api.saveActorMemory('age', birthYear.trim()).catch(() => {});
      }
      // 아직 저장 못 하는 칸은 계측만 한다(웹의 theory와 같은 상태).
      logEvent('profile_setup', {
        mediums: mediums.join(',') || 'none',
        career: career !== null ? String(career) : 'none',
        goal: goal !== null ? String(goal) : 'none',
      });
      await completeProfileSetup(name.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('profileName.fail'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={keyboardHeight > 0 ? ['top'] : ['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.flex, { paddingBottom: keyboardHeight }]}>
        <KeyboardAwareScroll
          contentContainerStyle={styles.content}
          automaticallyAdjustKeyboardInsets={false}>
          <View>
            <Text style={styles.title}>{t('profileName.title')}</Text>
            <Text style={styles.subtitle}>{t('profileName.subtitle')}</Text>
          </View>

          <TextInput
            style={styles.nameInput}
            placeholder={t('profileName.placeholder')}
            placeholderTextColor={palette.textDim}
            value={name}
            onChangeText={setName}
            autoFocus
            returnKeyType="next"
          />

          <Field label={t('profileName.genderLabel')}>
            <View style={styles.chips}>
              {(['female', 'male', 'none'] as Gender[]).map((g) => (
                <Chip
                  key={g}
                  label={t(
                    g === 'female'
                      ? 'profileName.genderFemale'
                      : g === 'male'
                        ? 'profileName.genderMale'
                        : 'profileName.genderNone',
                  )}
                  selected={gender === g}
                  onPress={() => setGender((prev) => (prev === g ? null : g))}
                />
              ))}
            </View>
          </Field>

          <Field label={t('profileName.ageLabel')}>
            <TextInput
              style={styles.input}
              placeholder={t('profileName.agePlaceholder')}
              placeholderTextColor={palette.textFaint}
              value={birthYear}
              onChangeText={(v) => setBirthYear(v.replace(/[^0-9]/g, '').slice(0, 4))}
              keyboardType="number-pad"
              maxLength={4}
            />
          </Field>

          <Field label={t('profileName.mediumLabel')}>
            <View style={styles.chips}>
              {[
                { v: 'media', k: 'profileName.mediumMedia' },
                { v: 'stage', k: 'profileName.mediumStage' },
              ].map(({ v, k }) => (
                <Chip key={v} label={t(k)} selected={mediums.includes(v)} onPress={() => toggleMedium(v)} />
              ))}
            </View>
          </Field>

          <Field label={t('profileName.careerLabel')}>
            <View style={styles.chips}>
              {careers.map((label, i) => (
                <Chip
                  key={label}
                  label={label}
                  selected={career === i}
                  onPress={() => setCareer((prev) => (prev === i ? null : i))}
                />
              ))}
            </View>
          </Field>

          <Field label={t('profileName.goalLabel')}>
            <View style={styles.chips}>
              {goals.map((label, i) => (
                <Chip
                  key={label}
                  label={label}
                  selected={goal === i}
                  onPress={() => setGoal((prev) => (prev === i ? null : i))}
                />
              ))}
            </View>
          </Field>

          {error && <Text style={styles.error}>{error}</Text>}
        </KeyboardAwareScroll>
        <Pressable
          style={[styles.cta, (!name.trim() || busy) && styles.ctaDisabled]}
          onPress={() => void submit()}
          disabled={!name.trim() || busy}>
          {busy ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.ctaText}>{t('profileName.cta')}</Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={[styles.chip, selected && styles.chipOn]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}>
      <Text style={[styles.chipText, selected && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  flex: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 40, paddingBottom: 24, gap: 22 },
  title: { fontSize: 24, fontWeight: '800', color: palette.text },
  subtitle: { marginTop: 8, fontSize: 14, lineHeight: 20, color: palette.textDim },
  nameInput: {
    borderWidth: 1.5,
    borderColor: palette.blue,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    color: palette.text,
    fontSize: 15,
    fontWeight: '600',
  },
  field: { gap: 10 },
  fieldLabel: { fontSize: 13, fontWeight: '800', color: palette.textMuted },
  input: {
    backgroundColor: palette.bgSoft,
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 16,
    color: palette.text,
    fontSize: 15,
    fontWeight: '600',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.bg,
    paddingVertical: 11,
    paddingHorizontal: 16,
  },
  chipOn: { backgroundColor: palette.blueSoft, borderColor: palette.blue },
  chipText: { fontSize: 14, fontWeight: '700', color: palette.textDim },
  chipTextOn: { color: palette.blueDeep },
  error: { color: palette.danger, fontSize: 13 },
  cta: {
    backgroundColor: palette.blue,
    borderRadius: 16,
    padding: 17,
    alignItems: 'center',
    margin: 20,
  },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
});
