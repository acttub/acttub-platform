import type { Direction, Gender } from './profile-form.ts';

/** 프로필 값 → 화면 문구 키(locales profileName). 가입 위저드와 프로필 편집이 같이 쓴다. */
export const GENDER_LABEL_KEYS: Record<Gender, string> = {
  female: 'profileName.genderFemale',
  male: 'profileName.genderMale',
  unspecified: 'profileName.genderNone',
};

export const DIRECTION_LABEL_KEYS: Record<Direction, string> = {
  media: 'profileName.mediumMedia',
  stage: 'profileName.mediumStage',
};

/** 프로필 편집에서 한 번에 하나만 고치는 항목(profile-edit-item 의 field). */
export type ProfileEditField = 'name' | 'bio' | 'birth' | 'gender' | 'goal' | 'career' | 'directions';
