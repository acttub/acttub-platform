import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';

import { discardDeviceFiles, trackTemporaryDeviceFile } from '@/lib/account-files';
import { api, type MeResponse } from '@/lib/api';
import { translate } from '@/lib/i18n';
import type { Portfolio } from '@/lib/portfolio';
import { uploadProfilePhoto, type PhotoUploadIntent } from '@/lib/profile-photo';

/**
 * 갤러리에서 사진을 골라 줄여서 올린다. 취소하면 null. 프로필 사진과 포트폴리오 사진이 같이 쓴다.
 *
 * 올리기 전에 항상 긴 변 2048px 의 JPEG 로 줄인다(profile-photo). 줄이는 네이티브 모듈
 * (react-native-compressor)이 없는 빌드(Expo Go 등)에서는 원본을 그대로 올리지 않고 막는다 —
 * "항상 줄여서 올린다"가 규칙이라 예외를 두지 않는다.
 */
async function pickAndUpload<Result, Intent extends PhotoUploadIntent>(options: {
  /** 프로필 사진은 고를 때 정사각으로 자른다. 포트폴리오 사진은 비율을 그대로 둔다. */
  square: boolean;
  createIntent: (input: { content_type: string; size_bytes: number }) => Promise<Intent>;
  complete: (intent: Intent) => Promise<Result>;
}): Promise<Result | null> {
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: options.square,
    ...(options.square ? { aspect: [1, 1] as [number, number] } : {}),
    quality: 1,
  });
  if (picked.canceled || !picked.assets[0]) return null;

  let compressor: typeof import('react-native-compressor');
  try {
    compressor = require('react-native-compressor');
  } catch {
    // 올리지 못해도 사진 고르기가 캐시에 만든 복사본은 남기지 않는다.
    void discardDeviceFiles([picked.assets[0].uri]);
    throw new Error(translate('profileName.photoUnavailable'));
  }

  return uploadProfilePhoto<Result, Intent>(picked.assets[0].uri, {
    compress: (uri, compression) => compressor.Image.compress(uri, compression),
    trackTemporary: trackTemporaryDeviceFile,
    discard: discardDeviceFiles,
    sizeOf: async (uri) => {
      const info = await FileSystem.getInfoAsync(uri);
      return info.exists && typeof info.size === 'number' ? info.size : null;
    },
    createIntent: options.createIntent,
    put: async (uploadUrl, uri, contentType) => {
      const upload = await api.startUploadToUrl(uploadUrl, uri, contentType).result;
      if (upload.kind !== 'uploaded') throw new Error(translate('profileName.photoFail'));
    },
    complete: options.complete,
  });
}

/** 프로필 사진 — 정사각으로 잘라 올린다. 서버가 옛 사진을 바꾼다. */
export function pickAndUploadProfilePhoto(): Promise<MeResponse | null> {
  return pickAndUpload({
    square: true,
    createIntent: (input) => api.createProfilePhotoIntent(input),
    complete: () => api.completeProfilePhoto(),
  });
}

/** 포트폴리오 사진 — 목록 맨 끝에 붙는다. 바뀐 포트폴리오 전체를 돌려준다. */
export function pickAndUploadPortfolioPhoto(): Promise<Portfolio | null> {
  return pickAndUpload({
    square: false,
    createIntent: (input) => api.createPortfolioPhotoIntent(input),
    complete: (intent) => api.completePortfolioPhoto(intent.photo_id),
  });
}

/** 프로필 사진을 지우고 바뀐 내 계정을 돌려준다. 사진이 없어도 된다(멱등). */
export async function removeProfilePhoto(): Promise<MeResponse> {
  await api.deleteProfilePhoto();
  return api.me();
}
