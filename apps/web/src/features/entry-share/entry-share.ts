import type { Metadata } from "next";

import type { PublicEntry, PublicEntryLookup } from "@/lib/api/v2/public-entry";
import { buildRootMetadata, resolveSiteUrl } from "@/lib/seo/site-metadata";

// 참여작 공유 링크(challenge.share). 앱이 공유하는 주소는 <사이트>/e/<참여작 id> 이고
// (apps/mobile/lib/challenge/deeplink.ts). 이 파일은 서버(메타데이터)용이고, 앱으로 여는 길은
// 클라이언트 번들에 들어가는 open-in-app.ts 에 따로 둔다 — 여기는 site-metadata 를 끌고 온다.

/** 설명에 싣는 대사의 최대 글자 수. 메신저 미리보기는 두세 줄에서 자른다. */
const LINE_PREVIEW_MAX = 80;

export const ENTRY_NOT_FOUND_COPY = {
  title: "영상을 찾을 수 없어요",
  body: "비공개로 바뀌었거나 지워진 영상일 수 있어요.",
} as const;

export const ENTRY_FAILED_COPY = {
  title: "잠시 뒤 다시 열어 주세요",
  body: "지금은 불러오지 못했어요. 앱에서는 볼 수 있을 수도 있어요.",
} as const;

export const ENTRY_SHARE_DESCRIPTION =
  "액터브 챌린지에 올라온 연기 영상이에요. 앱에서 볼 수 있어요.";

/** 제목. 작품에 배역이 있으면 "작품 · 배역 역" 이다. 작성자는 싣지 않는다. */
export function entryTitle(entry: Pick<PublicEntry, "work" | "character">): string {
  return entry.character ? `${entry.work} · ${entry.character} 역` : entry.work;
}

/** 대사는 코드 포인트로 세어 자른다 — 한글·이모지를 반쪽으로 끊지 않는다. */
export function linePreview(line: string): string {
  const chars = Array.from(line.trim());
  if (chars.length <= LINE_PREVIEW_MAX) return chars.join("");
  return `${chars.slice(0, LINE_PREVIEW_MAX).join("").trimEnd()}…`;
}

/**
 * 공유 페이지의 메타데이터. 검색 엔진에는 싣지 않는다(noindex) — 링크를 받은 사람의 메신저 미리보기용이다.
 * 장면 이미지가 없으면 사이트 공통 OG 이미지(src/app/opengraph-image.tsx·twitter-image.tsx)로 대신한다.
 * 페이지가 openGraph 를 직접 정하면 상위의 파일 이미지가 따라오지 않으므로 주소를 명시한다.
 */
export function entryShareMetadata(
  id: string,
  lookup: PublicEntryLookup,
  siteUrl?: string,
): Metadata {
  const resolvedSiteUrl = resolveSiteUrl(siteUrl);
  const root = buildRootMetadata(resolvedSiteUrl);
  const found = lookup.kind === "found" ? lookup.entry : null;
  const title = found
    ? entryTitle(found)
    : lookup.kind === "not_found"
      ? ENTRY_NOT_FOUND_COPY.title
      : ENTRY_FAILED_COPY.title;
  const description = found
    ? `“${linePreview(found.line)}” — ${ENTRY_SHARE_DESCRIPTION}`
    : ENTRY_SHARE_DESCRIPTION;
  const poster = found?.poster_url ?? null;

  return {
    metadataBase: root.metadataBase,
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: {
      ...root.openGraph,
      type: "website",
      url: `${resolvedSiteUrl}/e/${encodeURIComponent(id)}`,
      title: `${title} | Acttub`,
      description,
      images: [poster ?? "/opengraph-image"],
    },
    twitter: {
      card: "summary_large_image",
      title: `${title} | Acttub`,
      description,
      images: [poster ?? "/twitter-image"],
    },
  };
}
