import { Stack, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { api } from '@/lib/api';
import {
  DISCOVERY_OTHER_MAX_LENGTH,
  EMPTY_DISCOVERY,
  INSTAGRAM_DETAILS,
  buildDiscoveryPayload,
  chooseDiscoverySource,
  chooseInstagramDetail,
  discoveryOrder,
  limitOtherText,
  type DiscoveryState,
} from '@/lib/discovery';
import { logMetaEvent } from '@/lib/meta-events';
import { recordSignupCompleted } from '@/lib/signup-attribution-runtime';
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
  checkBirthDate,
  formatBirthDateInput,
  initialProfileForm,
  isBioValid,
  isProfileFormComplete,
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
 * 가입 게이트(edit=false)와 설정의 프로필 편집(edit=true)이 같은 폼과 같은 API
 * (PUT /v2/me/profile)를 쓴다. 여섯 항목을 한 번에 저장하고 부분 저장은 없다 — 입력 도중
 * 앱을 닫으면 다음에 처음부터 다시 시작한다. 고칠 때도 필수 규칙은 같아 비워서 저장할 수 없다.
 *
 * 사진과 한 줄 소개(80자)는 선택 항목이고 설정에서만 받는다 — 편집(edit=true)에만 보인다.
 * 사진은 고르는 즉시 올리고(올리기 전에 항상 긴 변 2048px JPEG 로 줄인다), 소개는 여섯
 * 항목과 함께 저장한다.
 *
 * 편집은 별도 라우트(/profile-edit)에서 렌더한다. `profile-name` 라우트는 _layout의
 * 부트스트랩 게이트가 가입 게이트 전용으로 취급해 게이트를 지난 회원을 홈으로 되돌리기 때문이다.
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
  const keyboardHeight = useKeyboardHeight();
  // 가입 직후 유입 경로(SOMA-649). 가입 게이트에서만 묻는 선택 항목이다. 순서는 화면을 열 때 한 번 섞는다.
  const [discovery, setDiscovery] = useState<DiscoveryState>(EMPTY_DISCOVERY);
  const discoverySources = useMemo(() => discoveryOrder(), []);
  const prefilled = useRef(false);

  const me = profile.me;
  // 서버에서 받은 값으로 한 번만 채운다. 0.1.0 이전 회원은 옛 닉네임이 이름 칸에 채워져 오고,
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
  const birthCheck = checkBirthDate(form.birthDate, new Date());
  const birthError =
    birthCheck.kind === 'invalid'
      ? t('profileName.birthInvalid')
      : birthCheck.kind === 'under_minimum'
        ? t('profileName.under14')
        : null;
  // 가입 게이트에서는 안 채운 칸의 별표를 회색으로 둔다. 편집은 이미 완성된 프로필이다.
  const missing = {
    name: !isEdit && form.name.trim().length === 0,
    gender: !isEdit && form.gender === null,
    birthDate: !isEdit && birthCheck.kind !== 'ok',
    directions: !isEdit && form.directions.length === 0,
    experience: !isEdit && form.experience === null,
    goal: !isEdit && form.goal === null,
  };

  const update = (patch: Partial<ProfileFormState>) => setForm((prev) => ({ ...prev, ...patch }));

  const toggleDirection = (direction: Direction) =>
    update({
      directions: form.directions.includes(direction)
        ? form.directions.filter((d) => d !== direction)
        : [...form.directions, direction],
    });

  const submit = async () => {
    setBusy(true);
    setError(null);
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
      if (!isEdit) {
        logMetaEvent('fb_mobile_complete_registration');
        // 이 기기에서 가입을 마친 계정에만 유입 광고를 붙인다(SOMA-588).
        if (me?.id) recordSignupCompleted(me.id);
        // 처음 어디서 알게 됐는지(SOMA-649). 고르지 않았으면 건너뜀으로 적는다. 저장은 끝났으므로 기다리지 않고,
        // 실패해도 가입 흐름을 막지 않는다(서버는 처음 답만 남긴다).
        void api.recordDiscoveryAnswer(buildDiscoveryPayload(discovery)).catch(() => {});
      }
      // 가입 게이트에서는 저장이 곧 게이트 통과라 _layout이 화면을 옮긴다. 편집은 직접 돌아간다.
      if (isEdit) router.back();
    } catch (cause) {
      const failure = profileSaveFailure(cause);
      if (failure.kind === 'account_closed') {
        // 가입 게이트의 만 14세 미만. 서버가 계정을 닫았다 — 안내를 남기고 로그인으로 간다.
        await closeAccountUnder14();
        return;
      }
      // 칸에서 이미 막으므로 여기 오는 것은 기기 날짜가 어긋난 경우 같은 안전망이다.
      if (failure.kind === 'under_14') setError(t('profileName.under14'));
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

          <Field label={t('profileName.nameLabel')} required missing={missing.name}>
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

          <Field label={t('profileName.genderLabel')} required missing={missing.gender}>
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

          <Field label={t('profileName.birthLabel')} required missing={missing.birthDate}>
            <TextInput
              style={styles.input}
              placeholder={t('profileName.birthPlaceholder')}
              placeholderTextColor={palette.textFaint}
              value={form.birthDate}
              onChangeText={(text) => update({ birthDate: formatBirthDateInput(text) })}
              keyboardType="number-pad"
              maxLength={10}
            />
            {birthError && <Text style={styles.fieldError}>{birthError}</Text>}
          </Field>

          <Field label={t('profileName.mediumLabel')} required missing={missing.directions}>
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

          <Field label={t('profileName.careerLabel')} required missing={missing.experience}>
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

          <Field label={t('profileName.goalLabel')} required missing={missing.goal}>
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

          {!isEdit && (
            <Field label={t('profileName.discoveryLabel')}>
              <Text style={styles.fieldHint}>{t('profileName.discoveryHint')}</Text>
              <View style={styles.chips}>
                {discoverySources.map((source) => (
                  <Chip
                    key={source}
                    label={t(`profileName.discoverySources.${source}`)}
                    selected={discovery.source === source}
                    onPress={() => setDiscovery((prev) => chooseDiscoverySource(prev, source))}
                  />
                ))}
              </View>
              {discovery.source === 'instagram' && (
                <View style={styles.discoveryFollowUp}>
                  <Text style={styles.fieldHint}>{t('profileName.discoveryInstagramLabel')}</Text>
                  <View style={styles.chips}>
                    {INSTAGRAM_DETAILS.map((detail) => (
                      <Chip
                        key={detail}
                        label={t(`profileName.discoveryInstagramDetails.${detail}`)}
                        selected={discovery.detail === detail}
                        onPress={() => setDiscovery((prev) => chooseInstagramDetail(prev, detail))}
                      />
                    ))}
                  </View>
                </View>
              )}
              {discovery.source === 'other' && (
                <TextInput
                  style={styles.input}
                  placeholder={t('profileName.discoveryOtherPlaceholder')}
                  placeholderTextColor={palette.textFaint}
                  value={discovery.otherText}
                  onChangeText={(text) => setDiscovery((prev) => ({ ...prev, otherText: limitOtherText(text) }))}
                  maxLength={DISCOVERY_OTHER_MAX_LENGTH * 2}
                />
              )}
            </Field>
          )}

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

/** 가입 게이트 라우트(/profile-name) — 게이트가 프로필이 빈 회원에게만 띄운다. */
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
      <Text style={styles.fieldLabel}>
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
  discoveryFollowUp: { marginTop: 10, gap: 8 },
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
  requiredStar: { color: palette.blue },
  requiredStarMissing: { color: palette.textFaint },
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
