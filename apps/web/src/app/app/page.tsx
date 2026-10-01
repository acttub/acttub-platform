import AppDownloadView from "./app-download-view";
import { buildAppDownloadBootstrapScript } from "@/lib/app-download/store-links";
import {
  buildMobileApplicationJsonLd,
  buildOrganizationJsonLd,
} from "@/lib/seo/json-ld";
import { JsonLd } from "@/lib/seo/json-ld-scripts";
import { buildAppDownloadMetadata } from "@/lib/seo/site-metadata";

export const metadata = buildAppDownloadMetadata();

export default function AppDownloadPage() {
  const jsonLdValues = [
    ...buildMobileApplicationJsonLd(),
    buildOrganizationJsonLd(),
  ];

  return (
    <>
      <JsonLd values={jsonLdValues} />
      {/* 인스타그램 UTM을 배지가 그려지는 즉시 /go까지 이어 준다. */}
      <script
        dangerouslySetInnerHTML={{ __html: buildAppDownloadBootstrapScript() }}
      />
      <AppDownloadView />
    </>
  );
}
