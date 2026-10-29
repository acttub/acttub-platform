/**
 * 앱 공지사항(app.notice, SOMA-919). 팝업으로 한 번 닫은 공지를 다시 볼 수 있게 서버(GET /v2/app/notices)가
 * 지금 떠 있는 공지와 끝난 공지를 공지한 날 늦은 순으로 준다. 제목·본문·이미지는 팝업 포스터와 같다.
 */

export type NoticeCtaAction = 'none' | 'cloud_voice_enable' | 'route' | 'url';

/** API 응답의 공지 한 건 그대로. */
export type Notice = {
  slug: string;
  revision: number;
  /** 지금 팝업 대상인 공지. false 면 끝난 공지다. */
  live: boolean;
  published_at: string;
  ends_at: string | null;
  badge: string | null;
  title: string;
  body: string | null;
  image_url: string | null;
  image_asset: string | null;
  cta_label: string | null;
  cta_action: NoticeCtaAction;
  cta_target: string | null;
  /** 작은 각주(선택). */
  footnote?: string | null;
  /** 그림 칸 배경색 #RRGGBB(선택). */
  image_bg?: string | null;
};

export type NoticesResponse = { notices: Notice[] };

/** 앱에 들어 있는 이미지. 서버가 이 밖의 이름을 주면 그림 칸을 숨긴다(팝업 포스터와 같다). */
export const NOTICE_IMAGE_ASSETS = ['mascot-reading'] as const;
export type NoticeImageAsset = (typeof NOTICE_IMAGE_ASSETS)[number];

export function noticeImageAsset(notice: Pick<Notice, 'image_asset'>): NoticeImageAsset | null {
  return (NOTICE_IMAGE_ASSETS as readonly string[]).includes(notice.image_asset ?? '')
    ? (notice.image_asset as NoticeImageAsset)
    : null;
}

export type NoticeCta = { kind: 'route' | 'url'; label: string; target: string };

/** 상세에서 누를 수 있는 버튼. 끝난 공지, 문구 없음, 안전하지 않은 대상, 앱 안 동의 시트가 필요한 동작은 null — 숨긴다. */
export function noticeCta(notice: Notice): NoticeCta | null {
  if (!notice.live || !notice.cta_label) return null;
  const target = notice.cta_target ?? '';
  if (notice.cta_action === 'route' && target.startsWith('/')) return { kind: 'route', label: notice.cta_label, target };
  if (notice.cta_action === 'url' && target.startsWith('https://')) return { kind: 'url', label: notice.cta_label, target };
  return null;
}

/** 공지한 날을 한국 날짜로 적는다(예: 2026년 11월 1일). 시각을 못 읽으면 빈 글자. */
export function formatNoticeDate(iso: string, locale: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return '';
  return new Intl.DateTimeFormat(locale, { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(time));
}

let cache: Notice[] | null = null;

/** 목록을 받은 뒤 상세가 같은 내용을 바로 보이도록 마지막 목록을 들고 있는다. */
export function rememberNotices(notices: Notice[]): void {
  cache = notices;
}

export function cachedNotice(slug: string): Notice | null {
  return cache?.find((notice) => notice.slug === slug) ?? null;
}

export function forgetNotices(): void {
  cache = null;
}
