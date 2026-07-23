import LandingClient from "./landing-client";
import {
  buildOrganizationJsonLd,
  buildSoftwareApplicationJsonLd,
  buildWebSiteJsonLd,
} from "@/lib/seo/json-ld";
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
    </>
  );
}
