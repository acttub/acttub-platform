import { ProfileForm } from './profile-name';

/**
 * 프로필 편집 — 설정에서 연다. 가입 게이트 라우트(/profile-name)와 달리 부트스트랩 게이트가
 * 건드리지 않아, 게이트를 지난 회원도 프로필을 고칠 수 있다.
 */
export default function ProfileEditScreen() {
  return <ProfileForm edit />;
}
