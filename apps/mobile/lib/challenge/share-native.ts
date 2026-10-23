import * as Clipboard from 'expo-clipboard';
import { File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { Linking, Platform, Share as SystemShare } from 'react-native';
import Share, { Social } from 'react-native-share';

import { INSTAGRAM_STORE_URL, ShareError, type VideoDeps } from './share.ts';

/**
 * 공유 시트의 네이티브 연결(SOMA-819). 판단은 `share.ts` 가 하고 여기는 모듈 호출만 한다.
 * 네이티브 모듈(react-native-share·expo-media-library·expo-clipboard)이 들어 있어 새 앱 빌드가 필요하다.
 */

/** 인스타 스토리는 Facebook App ID 가 필수다(Meta, 2023-01~). app.json 의 react-native-fbsdk-next appID 와 같은 값. */
export const FACEBOOK_APP_ID = '1535408487870893';

/** 재생 주소의 영상을 임시 폴더로 받는다. */
export const videoDeps: VideoDeps = {
  download: async (url) => {
    const target = new File(Paths.cache, `acttub-share-${Date.now()}.mp4`);
    const file = await File.downloadFileAsync(url, target);
    return { uri: file.uri, size: typeof file.size === 'number' ? file.size : null };
  },
  remove: (uri) => {
    try {
      new File(uri).delete();
    } catch {
      // 임시 파일이라 못 지워도 OS 가 캐시를 비운다.
    }
  },
};

export async function isInstagramInstalled(): Promise<boolean> {
  try {
    if (Platform.OS === 'ios') return await Linking.canOpenURL('instagram-stories://share');
    return (await Share.isPackageInstalled('com.instagram.android')).isInstalled;
  } catch {
    return false;
  }
}

export function instagramStoreUrl(): string | null {
  if (Platform.OS === 'ios') return INSTAGRAM_STORE_URL.ios;
  if (Platform.OS === 'android') return INSTAGRAM_STORE_URL.android;
  return null;
}

/** 인스타 스토리 편집 화면을 영상과 함께 연다. 사용자가 닫으면 던지는 오류는 호출하는 쪽이 무시한다. */
export async function shareVideoToInstagramStory(fileUri: string): Promise<void> {
  await Share.shareSingle({
    social: Social.InstagramStories,
    appId: FACEBOOK_APP_ID,
    backgroundVideo: fileUri,
  });
}

/** 사진첩에 저장한다. 쓰기 전용 권한(영상)만 묻는다. */
export async function saveVideoToLibrary(fileUri: string): Promise<void> {
  const permission = await MediaLibrary.requestPermissionsAsync(true, ['video']);
  if (!permission.granted) throw new ShareError('permission_denied');
  try {
    await MediaLibrary.saveToLibraryAsync(fileUri);
  } catch {
    throw new ShareError('save_failed');
  }
}

export async function copyText(text: string): Promise<void> {
  await Clipboard.setStringAsync(text);
}

/** 기기 기본 공유 창(카카오톡 등 SDK 없이 쓰는 길). */
export function openSystemShare(message: string): Promise<unknown> {
  return SystemShare.share({ message });
}

/**
 * 기기 공유 창에 영상 파일과 글을 같이 넘긴다. 카카오톡처럼 파일을 받으면 글을 버리는 앱도 있어
 * 영상이 먼저다. 사용자가 공유 창을 닫아도 던지지 않는다.
 */
export async function openSystemShareWithVideo(fileUri: string, message: string): Promise<void> {
  await Share.open({ url: fileUri, type: 'video/mp4', message, failOnCancel: false });
}

export function openUrl(url: string): Promise<unknown> {
  return Linking.openURL(url);
}
