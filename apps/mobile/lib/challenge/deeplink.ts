/**
 * 참여작 공유 딥링크(challenge.react).
 *
 * 공유는 참여작 링크를 보내는 것이고, 회원 앱에서 열면 노출 조건을 확인한 뒤 그 참여작부터
 * 피드를 연다. 볼 수 없게 됐으면(비공개·삭제·숨김·차단) 안내만 한다. 웹 공개 페이지는 없다.
 */
const SCHEME = 'actingapp';
const WEB_HOST = 'acttub.com';

export type EntryLink = { entryId: string };

/** 공유에 실어 보내는 주소. */
export function entryShareUrl(entryId: string): string {
  return `https://${WEB_HOST}/e/${encodeURIComponent(entryId)}`;
}

/**
 * 받은 주소에서 참여작 id 를 읽는다. 우리 주소가 아니면 null 이다.
 * `actingapp://entry/<id>` 와 `https://acttub.com/e/<id>` 둘 다 받는다.
 */
export function parseEntryLink(url: string): EntryLink | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  const appMatch = trimmed.match(new RegExp(`^${SCHEME}://entry/([^/?#]+)`, 'i'));
  if (appMatch) return { entryId: decodeURIComponent(appMatch[1]) };
  const webMatch = trimmed.match(new RegExp(`^https?://(?:www\\.)?${WEB_HOST.replace('.', '\\.')}/e/([^/?#]+)`, 'i'));
  if (webMatch) return { entryId: decodeURIComponent(webMatch[1]) };
  return null;
}
