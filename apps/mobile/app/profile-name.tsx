import { Stack, useRouter } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
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
import { getUserName, saveUserName, takeProviderNameHint } from '@/lib/profile';
import { translate as t, translateList } from '@/lib/i18n';

type Gender = 'female' | 'male' | 'none';

/**
 * A0.2 프로필 설정 — 온보딩에서 배우 정보를 받는다(pen A0.2).
 *
 * 이름은 프로필 셋업, 성별·나이는 배우 전용 기억(gender·age)에 저장한다. 추구 방향·연기
 * 경력·최종 목표는 아직 저장할 서버 필드가 없어 계측만 한다(theory 칩과 같은 상태).
 * 온보딩에선 전부 필수(빈 칸이 있으면 시작하기가 잠긴다). 편집 모드는 이름만 필수.
 */
/**
 * 프로필 폼 — 온보딩(edit=false)과 설정의 프로필 편집(edit=true)이 공유한다.
 *
 * 편집은 별도 라우트(/profile-edit)에서 렌더한다. `profile-name` 라우트는 _layout의
 * 부트스트랩 게이트가 온보딩 전용으로 취급해 다 끝난 유저를 홈으로 되돌리기 때문이다.
 */
export function ProfileForm({ edit: isEdit }: { edit: boolean }) {
  const { completeProfileSetup } = useAuth();
  const router = useRouter();
  // 온보딩이면 로그인 제공자가 준 이름을 첫 값으로(저장은 시작하기를 눌러야). 편집은 저장값을 불러온다.
  const [name, setName] = useState(() => (isEdit ? '' : (takeProviderNameHint() ?? '')));
  const [gender, setGender] = useState<Gender | null>(null);
  const [age, setAge] = useState('');
  const [mediums, setMediums] = useState<string[]>([]);
  const [career, setCareer] = useState<number | null>(null);
  const [goal, setGoal] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keyboardHeight = useKeyboardHeight();

  const careers = translateList('profileName.careerOptions');
  const goals = translateList('profileName.goalOptions');
  // 온보딩은 인적사항 전부 필수. 편집은 이름만. 뭐가 비었는지도 그대로 보여준다.
  const ageOk = /^[1-9][0-9]?$/.test(age.trim());
  const missing: string[] = [];
  if (!name.trim()) missing.push(t('profileName.nameMissingLabel'));
  if (gender === null) missing.push(t('profileName.genderLabel'));
  if (!ageOk) missing.push(t('profileName.ageLabel'));
  if (mediums.length === 0) missing.push(t('profileName.mediumShortLabel'));
  if (career === null) missing.push(t('profileName.careerLabel'));
  if (goal === null) missing.push(t('profileName.goalLabel'));
  const complete = isEdit ? name.trim().length > 0 : missing.length === 0;

  // 편집 모드에서는 저장된 값(이름·성별·나이)을 미리 채운다.
  useEffect(() => {
    if (!isEdit) return;
    let alive = true;
    void getUserName().then((n) => alive && n && setName(n));
    void api
      .actorMemory()
      .then(({ items }) => {
        if (!alive) return;
        for (const it of items) {
          if (it.field === 'gender') setGender(it.value === '남성' ? 'male' : it.value === '여성' ? 'female' : null);
          if (it.field === 'age') setAge(it.value.replace(/[^0-9]/g, '').slice(0, 2));
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [isEdit]);

  const toggleMedium = (v: string) =>
    setMediums((prev) => (prev.includes(v) ? prev.filter((m) => m !== v) : [...prev, v]));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      // 저장되는 칸(성별·나이). 실패해도 흐름을 막지 않는다.
      if (gender === 'female' || gender === 'male') {
        await api.saveActorMemory('gender', gender === 'female' ? '여성' : '남성').catch(() => {});
      }
      if (ageOk) {
        await api.saveActorMemory('age', `${age.trim()}세`).catch(() => {});
      }
      // 아직 저장 못 하는 칸은 계측만 한다(웹의 theory와 같은 상태).
      logEvent(isEdit ? 'profile_edit' : 'profile_setup', {
        mediums: mediums.join(',') || 'none',
        career: career !== null ? String(career) : 'none',
        goal: goal !== null ? String(goal) : 'none',
      });
      if (isEdit) {
        await saveUserName(name.trim());
        router.back();
      } else {
        // 온보딩: completeProfileSetup이 게이트를 진행시키며 화면을 떠난다(마지막에 호출).
        await completeProfileSetup(name.trim());
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('profileName.fail'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={isEdit ? (keyboardHeight > 0 ? [] : ['bottom']) : keyboardHeight > 0 ? ['top'] : ['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: isEdit, title: t('profileName.editTitle') }} />
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
            autoFocus={!isEdit}
            returnKeyType="next"
          />

          <Field label={t('profileName.genderLabel')} required={!isEdit} missing={!isEdit && gender === null}>
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

          <Field label={t('profileName.ageLabel')} required={!isEdit} missing={!isEdit && !ageOk}>
            <TextInput
              style={styles.input}
              placeholder={t('profileName.agePlaceholder')}
              placeholderTextColor={palette.textFaint}
              value={age}
              onChangeText={(v) => setAge(v.replace(/[^0-9]/g, '').slice(0, 2))}
              keyboardType="number-pad"
              maxLength={2}
            />
          </Field>

          <Field label={t('profileName.mediumLabel')} required={!isEdit} missing={!isEdit && mediums.length === 0}>
            <View style={styles.chips}>
              {[
                { v: 'media', k: 'profileName.mediumMedia' },
                { v: 'stage', k: 'profileName.mediumStage' },
              ].map(({ v, k }) => (
                <Chip key={v} label={t(k)} selected={mediums.includes(v)} onPress={() => toggleMedium(v)} />
              ))}
            </View>
          </Field>

          <Field label={t('profileName.careerLabel')} required={!isEdit} missing={!isEdit && career === null}>
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

          <Field label={t('profileName.goalLabel')} required={!isEdit} missing={!isEdit && goal === null}>
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
          {!isEdit && !complete && (
            <Text style={styles.requiredHint}>{t('profileName.missingHint', { fields: missing.join(' · ') })}</Text>
          )}
        </KeyboardAwareScroll>
        <Pressable
          style={[styles.cta, (!complete || busy) && styles.ctaDisabled]}
          onPress={() => void submit()}
          disabled={!complete || busy}>
          {busy ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.ctaText}>{t(isEdit ? 'profileName.editCta' : 'profileName.cta')}</Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

/** 온보딩 라우트(/profile-name) — 게이트가 신규 유저에게만 띄운다. */
export default function ProfileNameScreen() {
  return <ProfileForm edit={false} />;
}

function Field({
  label,
  required,
  missing,
  children,
}: {
  label: string;
  required?: boolean;
  missing?: boolean;
  children: ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, missing && styles.fieldLabelMissing]}>
        {label}
        {required && <Text style={missing ? styles.requiredStarMissing : styles.requiredStar}> *</Text>}
      </Text>
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
  requiredHint: { color: palette.textFaint, fontSize: 12.5, textAlign: 'center' },
  requiredStar: { color: palette.blue },
  requiredStarMissing: { color: palette.danger },
  fieldLabelMissing: { color: palette.danger },
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
