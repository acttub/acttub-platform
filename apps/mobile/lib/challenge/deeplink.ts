/**
 * 참여작 공유 딥링크(challenge.react).
 *
 * 공유는 참여작 링크를 보내는 것이고, 회원 앱에서 열면 노출 조건을 확인한 뒤 그 참여작부터
 * 피드를 연다. 볼 수 없게 됐으면(비공개·삭제·숨김·차단) 안내만 한다. 같은 주소의 웹 페이지
 * (`apps/web/src/app/e/[id]`)는 메신저 미리보기용 공유 페이지다.
 */
import { isProductionApiUrl } from '../api-env.ts';

const PRODUCTION_WEB_HOST = 'acttub.com';

/**
 * 공유 페이지 호스트. 참여작은 앱이 붙은 서버에만 있으므로 dev 앱이 운영 주소를 보내면
 * 받는 사람이 「영상을 찾을 수 없어요」를 본다. 운영 API면(또는 값이 없거나 깨졌으면) acttub.com,
 * 그 밖에는 API 주소의 호스트(예: dev.acttub.com)를 쓴다.
 */
export function shareWebHost(apiUrl: string | undefined): string {
  if (!apiUrl?.trim() || isProductionApiUrl(apiUrl)) return PRODUCTION_WEB_HOST;
  try {
    return new URL(apiUrl.trim()).host || PRODUCTION_WEB_HOST;
  } catch {
    return PRODUCTION_WEB_HOST;
  }
}

// Metro 는 `process.env.EXPO_PUBLIC_*` 리터럴만 치환한다.
const WEB_HOST = shareWebHost(process.env.EXPO_PUBLIC_API_URL);

/** 공유에 실어 보내는 주소. */
export function entryShareUrl(entryId: string): string {
  return `https://${WEB_HOST}/e/${encodeURIComponent(entryId)}`;
}
