import LandingClient from "./landing-client";
import {
  buildOrganizationJsonLd,
  buildSoftwareApplicationJsonLd,
  buildWebSiteJsonLd,
} from "@/lib/seo/json-ld";
import { JsonLd } from "@/lib/seo/json-ld-scripts";
import { buildAppDownloadBootstrapScript } from "@/lib/app-download/store-links";
import type { LandingVariant } from "@/lib/landing-variant";

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
      <LandingClient variant={variant} />
    </>
  );
}
