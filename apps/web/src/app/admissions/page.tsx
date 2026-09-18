import { AdmissionsPage } from "@/features/admissions/admissions-page";
import { loadAdmissionsStatic } from "@/features/admissions/admissions-static";
import {
  buildAdmissionsBreadcrumbJsonLd,
  buildOrganizationJsonLd,
} from "@/lib/seo/json-ld";
import { buildAdmissionsIndexMetadata } from "@/lib/seo/site-metadata";

// 공개 입시 정보는 sitemap과 색인 허용 목록에 함께 둔다.
export const metadata = buildAdmissionsIndexMetadata();

export default function Page() {
  const initial = loadAdmissionsStatic();
  const jsonLdValues = [
    buildAdmissionsBreadcrumbJsonLd(),
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
      <AdmissionsPage initial={initial} />
    </>
  );
}
