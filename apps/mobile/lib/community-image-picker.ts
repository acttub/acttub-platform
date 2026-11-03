import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';

import { discardDeviceFiles, trackTemporaryDeviceFile } from '@/lib/account-files';
import { api } from '@/lib/api';
import { uploadCommunityImage } from '@/lib/community-image';
import { translate } from '@/lib/i18n';

/**
 * 게시판 사진 고르기·올리기의 기기 쪽(SOMA-873). 순서는 lib/community-image, 줄이기·올리기 모듈은 포트폴리오 사진과 같다.
 *
 * 고르기 전에 사진 접근 권한을 묻는다. 다시 물을 수 없게 거절돼 있으면 'blocked' 를 돌려 화면이 설정 열기 안내를 띄운다.
 */
export type PickResult = { kind: 'picked'; uris: string[] } | { kind: 'cancelled' } | { kind: 'denied' } | { kind: 'blocked' };

export async function pickCommunityImages(limit: number): Promise<PickResult> {
  if (limit <= 0) return { kind: 'cancelled' };
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted && permission.accessPrivileges !== 'limited') {
    return permission.canAskAgain === false ? { kind: 'blocked' } : { kind: 'denied' };
  }
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: limit,
    orderedSelection: true,
    quality: 1,
  });
  if (picked.canceled || picked.assets.length === 0) return { kind: 'cancelled' };
  return { kind: 'picked', uris: picked.assets.map((a) => a.uri) };
}

/** 고른 사진 한 장을 줄여 올리고 서버 사진 id 를 돌려준다. 줄이는 모듈이 없는 빌드에서는 원본을 올리지 않고 실패한다. */
export async function uploadPickedImage(uri: string): Promise<string> {
  let compressor: typeof import('react-native-compressor');
  try {
    compressor = require('react-native-compressor');
  } catch {
    throw new Error(translate('communityNew.imageUnavailable'));
  }
  return uploadCommunityImage(uri, {
    compress: (input, options) => compressor.Image.compress(input, options),
    trackTemporary: trackTemporaryDeviceFile,
    discard: discardDeviceFiles,
    sizeOf: async (input) => {
      const info = await FileSystem.getInfoAsync(input);
      return info.exists && typeof info.size === 'number' ? info.size : null;
    },
    createIntent: (input) => api.createCommunityImageIntent(input),
    put: async (uploadUrl, input, headers) => {
      const upload = await api.startUploadToUrl(uploadUrl, input, headers['Content-Type'] ?? 'image/jpeg', headers).result;
      if (upload.kind !== 'uploaded') throw new Error(translate('communityNew.imageFail'));
    },
    complete: (imageId) => api.completeCommunityImage(imageId),
  });
}

/** 화면을 닫을 때 고른 사진 복사본을 기기에서 지운다. 서버 주소(고치는 글의 기존 사진)는 건드리지 않는다. */
export function discardPickedImages(uris: string[]): void {
  const local = uris.filter((u) => u.startsWith('file:'));
  if (local.length) void discardDeviceFiles(local).catch(() => undefined);
}
