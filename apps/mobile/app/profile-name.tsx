import { Stack, useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Image,
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
import { logEvent } from '@/lib/analytics';
import { logMetaEvent } from '@/lib/meta-events';
import { useAuth } from '@/lib/auth';
import { takeProviderNameHint } from '@/lib/profile';
import { pickAndUploadProfilePhoto, removeProfilePhoto } from '@/lib/profile-photo-upload';
import {
  BIO_MAX_LENGTH,
  DIRECTION_VALUES,
  EXPERIENCE_VALUES,
  GENDER_VALUES,
  GOAL_VALUES,
  NAME_MAX_LENGTH,
  buildProfilePayload,
  formatBirthDateInput,
  initialProfileForm,
  isBioValid,
  isProfileFormComplete,
  parseBirthDate,
  profileSaveFailure,
  type Direction,
  type Gender,
  type ProfileFormState,
} from '@/lib/profile-form';
import { translate as t, translateList } from '@/lib/i18n';

const GENDER_LABEL_KEYS: Record<Gender, string> = {
  female: 'profileName.genderFemale',
  male: 'profileName.genderMale',
  unspecified: 'profileName.genderNone',
};
const DIRECTION_LABEL_KEYS: Record<Direction, string> = {
  media: 'profileName.mediumMedia',
  stage: 'profileName.mediumStage',
};

/**
 * A0.2 프로필 설정 — 이름·성별·생년월일·추구하는 방향·연기 경력·최종 목표 여섯을 모두 받는다.
 *
 * 온보딩(edit=false)과 설정의 프로필 편집(edit=true)이 같은 폼과 같은 API
 * (PUT /v2/me/profile)를 쓴다. 여섯 항목을 한 번에 저장하고 부분 저장은 없다 — 입력 도중
 * 앱을 닫으면 다음에 처음부터 다시 시작한다. 고칠 때도 필수 규칙은 같아 비워서 저장할 수 없다.
 *
 * 사진과 한 줄 소개(80자)는 선택 항목이고 설정에서만 받는다 — 편집(edit=true)에만 보인다.
 * 사진은 고르는 즉시 올리고(올리기 전에 항상 긴 변 2048px JPEG 로 줄인다), 소개는 여섯
 * 항목과 함께 저장한다.
 *
 * 편집은 별도 라우트(/profile-edit)에서 렌더한다. `profile-name` 라우트는 _layout의
 * 부트스트랩 게이트가 온보딩 전용으로 취급해 다 끝난 유저를 홈으로 되돌리기 때문이다.
 */
export function ProfileForm({ edit: isEdit }: { edit: boolean }) {
  const { profile, reloadProfile, saveProfile, setMe, closeAccountUnder14 } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState<ProfileFormState>(() => initialProfileForm(null, null));
  const [bio, setBio] = useState('');
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [birthError, setBirthError] = useState<string | null>(null);
  const keyboardHeight = useKeyboardHeight();
  const prefilled = useRef(false);

  const me = profile.me;
  // 서버에서 받은 값으로 한 번만 채운다. 1.0.0 이전 회원은 옛 닉네임이 이름 칸에 채워져 오고,
  // 이름이 없으면 로그인 제공자가 준 이름을 첫 값으로 쓴다(저장은 버튼을 눌러야).
  useEffect(() => {
    if (prefilled.current || !me) return;
    prefilled.current = true;
    setForm(initialProfileForm(me.profile, isEdit ? null : takeProviderNameHint()));
    setBio(me.profile?.bio ?? '');
  }, [me, isEdit]);

  const careers = translateList('profileName.careerOptions');
  const goals = translateList('profileName.goalOptions');
  const bioTooLong = isEdit && !isBioValid(bio);
  const complete = isProfileFormComplete(form, new Date()) && !bioTooLong;
  const nameTooLong = [...form.name.trim()].length > NAME_MAX_LENGTH;
  const birthDateTyped = form.birthDate.length === 10;

  const update = (patch: Partial<ProfileFormState>) => setForm((prev) => ({ ...prev, ...patch }));

  const toggleDirection = (direction: Direction) =>
    update({
      directions: form.directions.includes(direction)
        ? form.directions.filter((d) => d !== direction)
        : [...form.directions, direction],
    });

  const onBirthDateChange = (text: string) => {
    const birthDate = formatBirthDateInput(text);
    update({ birthDate });
    setBirthError(
      birthDate.length === 10 && parseBirthDate(birthDate, new Date()) === null
        ? t('profileName.birthInvalid')
        : null,
    );
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    setBirthError(null);
    try {
      const now = new Date();
      await saveProfile(
        // 한 줄 소개는 설정에서만 받는다. 가입 게이트에서는 키를 싣지 않는다.
        isEdit ? buildProfilePayload(form, now, { bio }) : buildProfilePayload(form, now),
      );
      logEvent(isEdit ? 'profile_edit' : 'profile_setup', {
        mediums: form.directions.join(',') || 'none',
        career: form.experience ?? 'none',
        goal: form.goal ?? 'none',
      });
      if (!isEdit) logMetaEvent('fb_mobile_complete_registration');
      // 온보딩은 저장이 곧 게이트 통과라 _layout이 화면을 옮긴다. 편집은 직접 돌아간다.
      if (isEdit) router.back();
    } catch (cause) {
      const failure = profileSaveFailure(cause);
      if (failure.kind === 'account_closed') {
        // 가입 게이트의 만 14세 미만. 서버가 계정을 닫았다 — 안내를 남기고 로그인으로 간다.
        await closeAccountUnder14();
        return;
      }
      if (failure.kind === 'under_14') setBirthError(t('profileName.under14'));
      else if (failure.kind === 'client_bug') setError(t('profileName.appBug'));
      else setError(cause instanceof Error ? cause.message : t('profileName.fail'));
    } finally {
      setBusy(false);
    }
  };

  // 사진은 여섯 항목과 따로, 고르는 즉시 올린다. 큰 사진도 앱이 줄여서 올리므로 거절되지 않는다.
  const changePhoto = async () => {
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      const next = await pickAndUploadProfilePhoto();
      if (next) setMe(next);
    } catch (cause) {
      setPhotoError(cause instanceof Error ? cause.message : t('profileName.photoFail'));
    } finally {
      setPhotoBusy(false);
    }
  };

  const removePhoto = async () => {
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      setMe(await removeProfilePhoto());
    } catch (cause) {
      setPhotoError(cause instanceof Error ? cause.message : t('profileName.photoFail'));
    } finally {
      setPhotoBusy(false);
    }
  };

  const edges = isEdit
    ? keyboardHeight > 0
      ? []
      : (['bottom'] as const)
    : keyboardHeight > 0
      ? (['top'] as const)
      : (['top', 'bottom'] as const);

  if (!me) {
    // 내 계정을 아직 못 읽었다. 읽기 전에 빈 폼을 보여 주면 옛 닉네임을 덮어쓰게 된다.
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <Stack.Screen options={{ headerShown: isEdit, title: t('profileName.editTitle') }} />
        <View style={styles.center}>
          {profile.status === 'error' ? (
            <>
              <Text style={styles.error}>{t('profileName.loadFail')}</Text>
              <Pressable style={styles.reload} onPress={() => void reloadProfile()} accessibilityRole="button">
                <Text style={styles.reloadText}>{t('profileName.reload')}</Text>
              </Pressable>
            </>
          ) : (
            <ActivityIndicator color={palette.blue} />
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={[...edges]}>
      <Stack.Screen options={{ headerShown: isEdit, title: t('profileName.editTitle') }} />
      <View style={[styles.flex, { paddingBottom: keyboardHeight }]}>
        <KeyboardAwareScroll
          contentContainerStyle={styles.content}
          automaticallyAdjustKeyboardInsets={false}>
          <View>
            <Text style={styles.title}>{t('profileName.title')}</Text>
            <Text style={styles.subtitle}>{t('profileName.subtitle')}</Text>
          </View>

          {isEdit && (
            <Field label={t('profileName.photoLabel')}>
              <View style={styles.photoRow}>
                <View style={styles.avatar}>
                  {photoBusy ? (
                    <ActivityIndicator color={palette.blue} />
                  ) : me.profile?.photo_url ? (
                    <Image source={{ uri: me.profile.photo_url }} style={styles.avatarImg} />
                  ) : (
                    <Text style={styles.avatarText}>{form.name.trim().charAt(0) || '?'}</Text>
                  )}
                </View>
                <View style={styles.photoActions}>
                  <Pressable
                    style={styles.photoBtn}
                    onPress={() => void changePhoto()}
                    disabled={photoBusy}
                    accessibilityRole="button">
                    <Text style={styles.photoBtnText}>
                      {t(me.profile?.photo_url ? 'profileName.photoChange' : 'profileName.photoAdd')}
                    </Text>
                  </Pressable>
                  {!!me.profile?.photo_url && (
                    <Pressable
                      style={styles.photoGhost}
                      onPress={() => void removePhoto()}
                      disabled={photoBusy}
                      accessibilityRole="button">
                      <Text style={styles.photoGhostText}>{t('profileName.photoRemove')}</Text>
                    </Pressable>
                  )}
                </View>
              </View>
              {photoError && <Text style={styles.fieldError}>{photoError}</Text>}
            </Field>
          )}

          <Field label={t('profileName.nameLabel')} required>
            <TextInput
              style={styles.nameInput}
              placeholder={t('profileName.placeholder')}
              placeholderTextColor={palette.textDim}
              value={form.name}
              onChangeText={(name) => update({ name })}
              autoFocus={!isEdit && form.name.length === 0}
              returnKeyType="next"
            />
            <Text style={nameTooLong ? styles.fieldError : styles.fieldHint}>
              {nameTooLong ? t('profileName.nameTooLong') : t('profileName.nameHint')}
            </Text>
          </Field>

          <Field label={t('profileName.genderLabel')} required>
            <View style={styles.chips}>
              {GENDER_VALUES.map((gender) => (
                <Chip
                  key={gender}
                  label={t(GENDER_LABEL_KEYS[gender])}
                  selected={form.gender === gender}
                  onPress={() => update({ gender })}
                />
              ))}
            </View>
          </Field>

          <Field label={t('profileName.birthLabel')} required>
            <TextInput
              style={styles.input}
              placeholder={t('profileName.birthPlaceholder')}
              placeholderTextColor={palette.textFaint}
              value={form.birthDate}
              onChangeText={onBirthDateChange}
              keyboardType="number-pad"
              maxLength={10}
            />
            {birthError && birthDateTyped && <Text style={styles.fieldError}>{birthError}</Text>}
          </Field>

          <Field label={t('profileName.mediumLabel')} required>
            <View style={styles.chips}>
              {DIRECTION_VALUES.map((direction) => (
                <Chip
                  key={direction}
                  label={t(DIRECTION_LABEL_KEYS[direction])}
                  selected={form.directions.includes(direction)}
                  onPress={() => toggleDirection(direction)}
                />
              ))}
            </View>
          </Field>

          <Field label={t('profileName.careerLabel')} required>
            <View style={styles.chips}>
              {EXPERIENCE_VALUES.map((experience, i) => (
                <Chip
                  key={experience}
                  label={careers[i] ?? experience}
                  selected={form.experience === experience}
                  onPress={() => update({ experience })}
                />
              ))}
            </View>
          </Field>

          <Field label={t('profileName.goalLabel')} required>
            <View style={styles.chips}>
              {GOAL_VALUES.map((goal, i) => (
                <Chip
                  key={goal}
                  label={goals[i] ?? goal}
                  selected={form.goal === goal}
                  onPress={() => update({ goal })}
                />
              ))}
            </View>
          </Field>

          {isEdit && (
            <Field label={t('profileName.bioLabel')}>
              <TextInput
                style={styles.input}
                placeholder={t('profileName.bioPlaceholder')}
                placeholderTextColor={palette.textFaint}
                value={bio}
                onChangeText={setBio}
                multiline
              />
              <Text style={bioTooLong ? styles.fieldError : styles.fieldHint}>
                {bioTooLong
                  ? t('profileName.bioTooLong')
                  : t('profileName.bioCount', { count: [...bio.trim()].length, max: BIO_MAX_LENGTH })}
              </Text>
            </Field>
          )}

          {error && <Text style={styles.error}>{error}</Text>}
          {!isEdit && !complete && <Text style={styles.requiredHint}>{t('profileName.requiredHint')}</Text>}
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

function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>
        {label}
        {required && <Text style={styles.requiredStar}> *</Text>}
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  reload: { paddingHorizontal: 16, paddingVertical: 8 },
  reloadText: { color: palette.blue, fontSize: 14, fontWeight: '700' },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: 18,
    backgroundColor: palette.blueSoft,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarText: { fontSize: 34, fontWeight: '800', color: palette.blue },
  photoActions: { gap: 6, alignItems: 'flex-start' },
  photoBtn: { backgroundColor: palette.blueSoft, borderRadius: 9999, paddingHorizontal: 14, paddingVertical: 9 },
  photoBtnText: { fontSize: 13, fontWeight: '800', color: palette.blueDeep },
  photoGhost: { paddingHorizontal: 14, paddingVertical: 6 },
  photoGhostText: { fontSize: 13, fontWeight: '700', color: palette.textDim },
  field: { gap: 10 },
  fieldLabel: { fontSize: 13, fontWeight: '800', color: palette.textMuted },
  fieldHint: { fontSize: 12.5, color: palette.textFaint },
  fieldError: { fontSize: 12.5, color: palette.danger },
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
