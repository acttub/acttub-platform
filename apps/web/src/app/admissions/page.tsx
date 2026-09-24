import { AdmissionsPage } from "@/features/admissions/admissions-page";
import {
  loadAdmissionsStatic,
  toAdmissionsListPayload,
} from "@/features/admissions/admissions-static";
import {
  buildAdmissionsBreadcrumbJsonLd,
  buildOrganizationJsonLd,
} from "@/lib/seo/json-ld";
import { buildAdmissionsIndexMetadata } from "@/lib/seo/site-metadata";

// 공개 입시 정보는 sitemap과 색인 허용 목록에 함께 둔다.
export const metadata = buildAdmissionsIndexMetadata();

export default function Page() {
  // 목록에 필요한 값만 넘긴다 — 넘긴 값이 통째로 HTML에 실린다(admissions-static 참고).
  const initial = toAdmissionsListPayload(loadAdmissionsStatic());
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
