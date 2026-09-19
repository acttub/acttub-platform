/**
 * 사진 올리기의 순서 — 프로필 사진(account.profile)과 포트폴리오 사진(account.portfolio)이
 * 같이 쓴다. 영상 업로드와 같은 방식이다 — 서버가 저장소 주소를 주고 앱이 거기에 직접 올린
 * 뒤 끝났다고 알린다.
 *
 * 큰 사진을 거절하지 않는다. 앱이 정사각으로 자르면서(고를 때) 긴 변 2048px 의 JPEG 로
 * 항상 줄여서 올린다. 서버의 10MB 제한과 이미지 검사는 앱을 거치지 않은 올리기를 막는
 * 안전망이라, 배우는 "사진이 너무 커요"를 보지 않는다.
 */
export const PROFILE_PHOTO_MAX_EDGE = 2048;

/** react-native-compressor 의 Image.compress 옵션. 가로·세로 어느 쪽이 길어도 2048 안에 든다. */
export const PROFILE_PHOTO_COMPRESSION = {
  compressionMethod: 'manual',
  maxWidth: PROFILE_PHOTO_MAX_EDGE,
  maxHeight: PROFILE_PHOTO_MAX_EDGE,
  output: 'jpg',
  quality: 0.85,
} as const;

const PHOTO_CONTENT_TYPE = 'image/jpeg';

/** 서버가 준 올릴 주소. 포트폴리오 사진은 끝을 알릴 때 쓸 photo_id 가 함께 온다. */
export type PhotoUploadIntent = { upload_url: string; expires_at: string };

export type ProfilePhotoDependencies<Result, Intent extends PhotoUploadIntent = PhotoUploadIntent> = {
  compress: (uri: string, options: typeof PROFILE_PHOTO_COMPRESSION) => Promise<string>;
  sizeOf: (uri: string) => Promise<number | null>;
  createIntent: (input: { content_type: string; size_bytes: number }) => Promise<Intent>;
  put: (uploadUrl: string, uri: string, contentType: string) => Promise<void>;
  /**
   * 서버가 객체를 확인하고 사진으로 붙인다(프로필은 옛 사진을 바꾸고, 포트폴리오는 맨 끝에
   * 붙인다). 주소를 받을 때의 응답을 넘겨받는다.
   */
  complete: (intent: Intent) => Promise<Result>;
};

export async function uploadProfilePhoto<Result, Intent extends PhotoUploadIntent = PhotoUploadIntent>(
  pickedUri: string,
  dependencies: ProfilePhotoDependencies<Result, Intent>,
): Promise<Result> {
  const uri = await dependencies.compress(pickedUri, PROFILE_PHOTO_COMPRESSION);
  const size = await dependencies.sizeOf(uri);
  if (size === null || size <= 0) throw new Error('사진 파일을 읽지 못했어요.');
  const intent = await dependencies.createIntent({
    content_type: PHOTO_CONTENT_TYPE,
    size_bytes: size,
  });
  await dependencies.put(intent.upload_url, uri, PHOTO_CONTENT_TYPE);
  return dependencies.complete(intent);
}
