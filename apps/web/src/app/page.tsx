import LandingClient from "./landing-client";
import {
  buildOrganizationJsonLd,
  buildSoftwareApplicationJsonLd,
  buildWebSiteJsonLd,
} from "@/lib/seo/json-ld";
import { buildAppDownloadBootstrapScript } from "@/lib/app-download/store-links";
import { buildLandingMetadata } from "@/lib/seo/site-metadata";

export const metadata = buildLandingMetadata();

export default function LandingPage() {
  const jsonLdValues = [
    buildWebSiteJsonLd(),
    buildSoftwareApplicationJsonLd(),
    buildOrganizationJsonLd(),
  ];

  return (
    <>
      {jsonLdValues.map((value) => (
        <script
          key={value["@id"]}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(value) }}
        />
      ))}
      {/* 버튼보다 앞에 둔다 — 클릭 가로채기를 먼저 걸어 두면 버튼이 아직 안 그려졌어도
          누르는 순간 스토어로 간다. 뒤에 두면 그 사이 파싱하는 동안 `/app` 으로 샌다. */}
      <script
        dangerouslySetInnerHTML={{ __html: buildAppDownloadBootstrapScript() }}
      />
      <LandingClient />
    </>
  );
}
