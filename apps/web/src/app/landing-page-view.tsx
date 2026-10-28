import { existsSync } from "node:fs";
import path from "node:path";

import LandingClient from "./landing-client";
import {
  FALLBACK_HERO_POSTER,
  HERO_POSTER_FILE,
  HERO_VIDEO_FILES,
  type HeroMedia,
} from "@/features/site/landing-hero-media";
import {
  buildOrganizationJsonLd,
  buildSoftwareApplicationJsonLd,
  buildWebSiteJsonLd,
} from "@/lib/seo/json-ld";
import { JsonLd } from "@/lib/seo/json-ld-scripts";
import { buildAppDownloadBootstrapScript } from "@/lib/app-download/store-links";
import type { LandingVariant } from "@/lib/landing-variant";

/**
 * B안 첫 화면 영상: public 에 실제로 있는 파일만 넘긴다. 정적 페이지라 빌드할 때 한 번 본다 —
 * 영상을 넣거나 바꾼 뒤 다시 빌드하면 반영되고, 없는 파일을 불러 404 를 내지 않는다.
 */
function resolveHeroMedia(): HeroMedia {
  const exists = (publicPath: string) => existsSync(path.join(process.cwd(), "public", publicPath));
  return {
    poster: exists(HERO_POSTER_FILE) ? HERO_POSTER_FILE : FALLBACK_HERO_POSTER,
    sources: HERO_VIDEO_FILES.filter((file) => exists(file.src)),
  };
}

/** `/` 와 안별 정적 페이지가 같이 쓰는 본문. 메타데이터는 각 page 가 같은 값을 내보낸다. */
export default function LandingPageView({ variant }: { variant: LandingVariant }) {
  const jsonLdValues = [
    buildWebSiteJsonLd(),
    buildSoftwareApplicationJsonLd(),
    buildOrganizationJsonLd(),
  ];

  return (
    <>
      <JsonLd values={jsonLdValues} />
      {/* 버튼보다 앞에 둔다 — 클릭 가로채기를 먼저 걸어 두면 버튼이 아직 안 그려졌어도
          누르는 순간 스토어로 간다. 뒤에 두면 그 사이 파싱하는 동안 `/app` 으로 샌다. */}
      <script
        dangerouslySetInnerHTML={{ __html: buildAppDownloadBootstrapScript() }}
      />
      <LandingClient variant={variant} heroMedia={variant === "b" ? resolveHeroMedia() : undefined} />
    </>
  );
}
