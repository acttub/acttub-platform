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
      <LandingClient />
      {/* 버튼보다 뒤에 둔다 — 문서를 읽어 내려오다 이 자리에서 바로 주소를 고친다.
          React 를 기다리면 느린 회선에서 2초쯤 `/app` 으로 새어 나간다. */}
      <script
        dangerouslySetInnerHTML={{ __html: buildAppDownloadBootstrapScript() }}
      />
    </>
  );
}
