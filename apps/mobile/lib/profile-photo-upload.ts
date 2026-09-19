import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';

import { api, type MeResponse } from '@/lib/api';
import { translate } from '@/lib/i18n';
import { uploadProfilePhoto } from '@/lib/profile-photo';

/**
 * 갤러리에서 사진을 골라 프로필 사진으로 올린다. 취소하면 null.
 *
 * 고를 때 정사각으로 자르고, 올리기 전에 항상 긴 변 2048px 의 JPEG 로 줄인다(profile-photo).
 * 줄이는 네이티브 모듈(react-native-compressor)이 없는 빌드(Expo Go 등)에서는 원본을 그대로
 * 올리지 않고 막는다 — "항상 줄여서 올린다"가 규칙이라 예외를 두지 않는다.
 */
export async function pickAndUploadProfilePhoto(): Promise<MeResponse | null> {
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 1,
  });
  if (picked.canceled || !picked.assets[0]) return null;

  let compressor: typeof import('react-native-compressor');
  try {
    compressor = require('react-native-compressor');
  } catch {
    throw new Error(translate('profileName.photoUnavailable'));
  }

  return uploadProfilePhoto<MeResponse>(picked.assets[0].uri, {
    compress: (uri, options) => compressor.Image.compress(uri, options),
    sizeOf: async (uri) => {
      const info = await FileSystem.getInfoAsync(uri);
      return info.exists && typeof info.size === 'number' ? info.size : null;
    },
    createIntent: (input) => api.createProfilePhotoIntent(input),
    put: async (uploadUrl, uri, contentType) => {
      const upload = await api.startUploadToUrl(uploadUrl, uri, contentType).result;
      if (upload.kind !== 'uploaded') throw new Error(translate('profileName.photoFail'));
    },
    complete: () => api.completeProfilePhoto(),
  });
}

/** 프로필 사진을 지우고 바뀐 내 계정을 돌려준다. 사진이 없어도 된다(멱등). */
export async function removeProfilePhoto(): Promise<MeResponse> {
  await api.deleteProfilePhoto();
  return api.me();
}
