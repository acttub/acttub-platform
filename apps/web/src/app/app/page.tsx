import AppDownloadView from "./app-download-view";
import {
  buildMobileApplicationJsonLd,
  buildOrganizationJsonLd,
} from "@/lib/seo/json-ld";
import { buildAppDownloadMetadata } from "@/lib/seo/site-metadata";

export const metadata = buildAppDownloadMetadata();

export default function AppDownloadPage() {
  const jsonLdValues = [
    ...buildMobileApplicationJsonLd(),
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
      <AppDownloadView />
    </>
  );
}
