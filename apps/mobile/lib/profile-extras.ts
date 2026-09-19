/**
 * 프로필 사진·한 줄 소개 — 기기 로컬(AsyncStorage) 보관.
 *
 * 서버에 프로필 사진/소개 필드가 아직 없어 화면 표시용으로만 둔다. 프로필 API가 생기면
 * 여기서 함께 올리도록 바꾸면 된다(profile.ts의 이름과 같은 처지).
 */

const PHOTO_KEY = 'acttub.profilePhotoUri';
const BIO_KEY = 'acttub.profileBio';

type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

// CI mobile 잡이 무설치 node --test 라 AsyncStorage 는 함수 안에서 lazy require.
function storage(): Storage {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@react-native-async-storage/async-storage').default as Storage;
}

export async function getProfilePhotoUri(): Promise<string | null> {
  try {
    return await storage().getItem(PHOTO_KEY);
  } catch {
    return null;
  }
}

export async function setProfilePhotoUri(uri: string | null): Promise<void> {
  if (uri) await storage().setItem(PHOTO_KEY, uri);
  else await storage().removeItem(PHOTO_KEY);
}

export async function getProfileBio(): Promise<string> {
  try {
    return (await storage().getItem(BIO_KEY)) ?? '';
  } catch {
    return '';
  }
}

export async function setProfileBio(bio: string): Promise<void> {
  const trimmed = bio.trim();
  if (trimmed) await storage().setItem(BIO_KEY, trimmed);
  else await storage().removeItem(BIO_KEY);
}
