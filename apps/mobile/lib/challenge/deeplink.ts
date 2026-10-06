/**
 * 참여작 공유 딥링크(challenge.react).
 *
 * 공유는 참여작 링크를 보내는 것이고, 회원 앱에서 열면 노출 조건을 확인한 뒤 그 참여작부터
 * 피드를 연다. 볼 수 없게 됐으면(비공개·삭제·숨김·차단) 안내만 한다. 같은 주소의 웹 페이지
 * (`apps/web/src/app/e/[id]`)는 메신저 미리보기용 공유 페이지다.
 */
const WEB_HOST = 'acttub.com';

/** 공유에 실어 보내는 주소. */
export function entryShareUrl(entryId: string): string {
  return `https://${WEB_HOST}/e/${encodeURIComponent(entryId)}`;
}
