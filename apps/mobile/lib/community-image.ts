/**
 * 게시판 사진 한 장 올리기의 순서(SOMA-873) — 포트폴리오 사진(lib/profile-photo)과 같은 방식이다.
 * 긴 변 1600px JPEG 로 줄임 → 크기 확인 → 서버에 올릴 주소 받기(POST /v2/community/images) → 그 주소로 PUT
 * (`upload_headers` 를 그대로 붙인다) → 끝났다고 알리기(POST /v2/community/images/{id}/complete). 사진 id 를 돌려준다.
 *
 * 줄인 파일은 올리기가 끝나면(성공·실패 모두) 기기에서 지운다. 고른 원본(사진 고르기의 캐시 복사본)은 썸네일로 쓰므로
 * 화면이 닫힐 때 지운다(장부에는 지금 적어 두어 앱이 도중에 죽어도 다음 실행이 지운다).
 */
import type { CommunityImageIntent } from './community.ts';
import { translate } from './i18n.ts';

export const COMMUNITY_IMAGE_MAX_EDGE = 1600;

/** react-native-compressor 의 Image.compress 옵션. 가로·세로 어느 쪽이 길어도 1600 안에 든다. */
export const COMMUNITY_IMAGE_COMPRESSION = {
  compressionMethod: 'manual',
  maxWidth: COMMUNITY_IMAGE_MAX_EDGE,
  maxHeight: COMMUNITY_IMAGE_MAX_EDGE,
  output: 'jpg',
  quality: 0.85,
} as const;

export const COMMUNITY_IMAGE_MIME = 'image/jpeg';

export type CommunityImageDependencies = {
  compress: (uri: string, options: typeof COMMUNITY_IMAGE_COMPRESSION) => Promise<string>;
  trackTemporary: (uri: string) => Promise<void>;
  discard: (uris: string[]) => Promise<void>;
  sizeOf: (uri: string) => Promise<number | null>;
  createIntent: (input: { mime_type: string; size_bytes: number }) => Promise<CommunityImageIntent>;
  put: (uploadUrl: string, uri: string, headers: Record<string, string>) => Promise<void>;
  complete: (imageId: string) => Promise<unknown>;
};

export async function uploadCommunityImage(pickedUri: string, deps: CommunityImageDependencies): Promise<string> {
  await deps.trackTemporary(pickedUri).catch(() => undefined);
  const made: string[] = [];
  try {
    const uri = await deps.compress(pickedUri, COMMUNITY_IMAGE_COMPRESSION);
    if (uri !== pickedUri) {
      made.push(uri);
      await deps.trackTemporary(uri).catch(() => undefined);
    }
    const size = await deps.sizeOf(uri);
    if (size === null || size <= 0) throw new Error(translate('communityNew.imageUnreadable'));
    const intent = await deps.createIntent({ mime_type: COMMUNITY_IMAGE_MIME, size_bytes: size });
    await deps.put(intent.upload_url, uri, { 'Content-Type': COMMUNITY_IMAGE_MIME, ...(intent.upload_headers ?? {}) });
    await deps.complete(intent.image_id);
    return intent.image_id;
  } finally {
    if (made.length) await deps.discard(made).catch(() => undefined);
  }
}
