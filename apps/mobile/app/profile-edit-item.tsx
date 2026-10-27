import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { InlineErrorLine } from '@/components/ui/inline-error';
import { TextField } from '@/components/ui/text-field';
import { palette } from '@/constants/palette';
import { space, type } from '@/constants/tokens';
import { logEvent } from '@/lib/analytics';
import { useAuth } from '@/lib/auth';
import { Checkbox } from '@/components/ui/checkbox';
import { LoadingText } from '@/components/ui/loading-text';
import { translate as t, translateList } from '@/lib/i18n';
import {
  BIO_MAX_LENGTH,
  DIRECTION_VALUES,
  EXPERIENCE_VALUES,
  GOAL_VALUES,
  NAME_MAX_LENGTH,
  buildProfilePayload,
  checkBirthDate,
  formatBirthDateInput,
  initialProfileForm,
  isBioValid,
  profileSaveFailure,
  type Gender,
  type ProfileFormState,
} from '@/lib/profile-form';
import { DIRECTION_LABEL_KEYS, GENDER_LABEL_KEYS, type ProfileEditField } from '@/lib/profile-labels';

const FIELDS: readonly ProfileEditField[] = ['name', 'bio', 'birth', 'gender', 'goal', 'career', 'directions'];
const GENDER_ORDER: readonly Gender[] = ['male', 'female', 'unspecified'];

const TITLE_KEYS: Record<ProfileEditField, string> = {
  name: 'profileName.nicknameLabel',
  bio: 'profileName.rowBio',
  birth: 'profileName.birthLabel',
  gender: 'profileName.genderLabel',
  goal: 'profileName.rowGoal',
  career: 'profileName.careerLabel',
  directions: 'profileName.rowDirections',
};

/**
 * 프로필 편집 · 항목(pen S5Lz2M, SOMA-748) — 프로필 편집에서 누른 항목 하나만 고치는 화면. 닉네임·소개·생년월일은
 * 글 입력, 나머지는 고르기. 오른쪽 위 「완료」로 저장하고 돌아간다.
 *
 * 서버(PUT /v2/me/profile)는 여섯 항목을 한 번에 받는다(부분 저장 없음). 그래서 지금 프로필 값에 고친 항목만 바꿔 통째로
 * 보낸다. 한 줄 소개도 같이 실어 지워지지 않게 한다.
 */
export default function ProfileEditItemScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ field?: string }>();
  const field: ProfileEditField = FIELDS.includes(params.field as ProfileEditField) ? (params.field as ProfileEditField) : 'name';
  const { profile, saveProfile } = useAuth();
  const me = profile.me;
  const [form, setForm] = useState<ProfileFormState>(() => initialProfileForm(me?.profile ?? null, null));
  const [bio, setBio] = useState(me?.profile?.bio ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = (patch: Partial<ProfileFormState>) => setForm((prev) => ({ ...prev, ...patch }));

  const now = new Date();
  const nameLength = [...form.name.trim()].length;
  const birthCheck = checkBirthDate(form.birthDate, now);
  const valid =
    field === 'name'
      ? nameLength > 0 && nameLength <= NAME_MAX_LENGTH
      : field === 'bio'
        ? isBioValid(bio)
        : field === 'birth'
          ? birthCheck.kind === 'ok'
          : field === 'directions'
            ? form.directions.length > 0
            : true;

  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await saveProfile(buildProfilePayload(form, new Date(), { bio }));
      void logEvent('profile_edit', {
        mediums: form.directions.join(',') || 'none',
        career: form.experience ?? 'none',
        goal: form.goal ?? 'none',
      });
      router.back();
    } catch (cause) {
      const failure = profileSaveFailure(cause);
      if (failure.kind === 'under_14') setError(t('profileName.under14'));
      else if (failure.kind === 'client_bug') setError(t('profileName.appBug'));
      else setError(cause instanceof Error ? cause.message : t('profileName.fail'));
    } finally {
      setBusy(false);
    }
  };

  const headerRight = () =>
    busy ? (
      <LoadingText label={t('loadingText.saving')} style={styles.saving} />
    ) : (
      <Pressable onPress={() => void save()} disabled={!valid} hitSlop={10} accessibilityRole="button">
        <Text style={[styles.done, !valid && styles.doneOff]}>{t('profileName.done')}</Text>
      </Pressable>
    );

  const goals = translateList('profileName.goalOptions');
  const careers = translateList('profileName.careerOptions');
  const choice = (key: string, label: string, selected: boolean, onPress: () => void, multi = false) => (
    <Pressable
      key={key}
      style={styles.option}
      onPress={onPress}
      accessibilityRole={multi ? 'checkbox' : 'radio'}
      accessibilityState={multi ? { checked: selected } : { selected }}>
      <Text style={[styles.optionText, selected && styles.optionTextOn]}>{label}</Text>
      <Checkbox checked={selected} />
    </Pressable>
  );

  let hint = t('profileName.hintPickOne');
  let body = null;
  switch (field) {
    case 'name':
      hint = t('profileName.hintWrite');
      body = (
        <>
          <TextField
            value={form.name}
            onChangeText={(name) => update({ name })}
            placeholder={t('profileName.placeholder')}
            autoFocus
            accessibilityLabel={t(TITLE_KEYS.name)}
            error={nameLength > NAME_MAX_LENGTH ? t('profileName.nameTooLong') : null}
          />
          {nameLength > NAME_MAX_LENGTH ? null : <Text style={styles.fieldHint}>{t('profileName.nameHint')}</Text>}
        </>
      );
      break;
    case 'bio':
      hint = t('profileName.hintWrite');
      body = (
        <>
          <TextField
            style={styles.multiline}
            value={bio}
            onChangeText={setBio}
            placeholder={t('profileName.bioPlaceholder')}
            multiline
            autoFocus
            accessibilityLabel={t(TITLE_KEYS.bio)}
            error={isBioValid(bio) ? null : t('profileName.bioTooLong')}
          />
          {isBioValid(bio) ? (
            <Text style={styles.fieldHint}>{t('profileName.bioCount', { count: [...bio.trim()].length, max: BIO_MAX_LENGTH })}</Text>
          ) : null}
        </>
      );
      break;
    case 'birth':
      hint = t('profileName.hintWrite');
      body = (
        <>
          <TextField
            value={form.birthDate}
            onChangeText={(text) => update({ birthDate: formatBirthDateInput(text) })}
            placeholder={t('profileName.birthPlaceholder')}
            keyboardType="number-pad"
            maxLength={10}
            autoFocus
            accessibilityLabel={t(TITLE_KEYS.birth)}
            error={
              birthCheck.kind === 'invalid'
                ? t('profileName.birthInvalid')
                : birthCheck.kind === 'under_minimum'
                  ? t('profileName.under14')
                  : null
            }
          />
        </>
      );
      break;
    case 'gender':
      body = GENDER_ORDER.map((gender) =>
        choice(gender, t(GENDER_LABEL_KEYS[gender]), form.gender === gender, () => update({ gender })),
      );
      break;
    case 'goal':
      body = GOAL_VALUES.map((goal, i) => choice(goal, goals[i] ?? goal, form.goal === goal, () => update({ goal })));
      break;
    case 'career':
      body = EXPERIENCE_VALUES.map((experience, i) =>
        choice(experience, careers[i] ?? experience, form.experience === experience, () => update({ experience })),
      );
      break;
    case 'directions':
      hint = t('profileName.hintPickMany');
      body = DIRECTION_VALUES.map((direction) =>
        choice(
          direction,
          t(DIRECTION_LABEL_KEYS[direction]),
          form.directions.includes(direction),
          () =>
            update({
              directions: form.directions.includes(direction)
                ? form.directions.filter((d) => d !== direction)
                : [...form.directions, direction],
            }),
          true,
        ),
      );
      break;
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: t(TITLE_KEYS[field]), headerRight }} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.hint}>{hint}</Text>
        <View style={styles.field}>{body}</View>
        {error && <InlineErrorLine message={error} />}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  body: { paddingHorizontal: space.gutter, paddingTop: space[2], paddingBottom: space[8], gap: space[3] },
  hint: { ...type.captionBold, color: palette.blueDeep },
  field: { gap: space[2] },
  done: { ...type.body2Bold, color: palette.blueDeep },
  doneOff: { color: palette.textDisabled },
  saving: { ...type.body2Bold, color: palette.textMeta },
  option: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: space[3], borderBottomWidth: 1, borderBottomColor: palette.border },
  optionText: { flex: 1, ...type.body1, color: palette.text },
  optionTextOn: { fontWeight: '700' },
  multiline: { minHeight: 96, paddingTop: space[3], textAlignVertical: 'top' },
  fieldHint: { ...type.caption, color: palette.textMeta },
});
