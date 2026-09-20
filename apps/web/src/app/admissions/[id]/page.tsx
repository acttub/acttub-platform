import { UniversityDetailPage } from "@/features/admissions/university-detail";
import { loadUniversityAdmissionsStatic } from "@/features/admissions/admissions-static";
import { universityIds } from "@/features/admissions/university-ids";
import {
  buildAdmissionsBreadcrumbJsonLd,
  buildAdmissionsWebPageJsonLd,
  buildOrganizationJsonLd,
} from "@/lib/seo/json-ld";
import { buildUniversityAdmissionsMetadata } from "@/lib/seo/site-metadata";
import { notFound } from "next/navigation";

// 공개 입시 정보는 sitemap과 색인 허용 목록에 함께 둔다.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const payload = loadUniversityAdmissionsStatic(id);
  if (!payload) notFound();
  return buildUniversityAdmissionsMetadata(payload);
}

// 정적 export라 빌드 시점에 경로를 전부 만들어 둔다. 목록에서 링크하는 id가
// 여기 없으면 그 대학만 404가 된다.
export function generateStaticParams() {
  return universityIds().map((id) => ({ id }));
}

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const initial = loadUniversityAdmissionsStatic(id);
  if (!initial) notFound();

  const university = initial.universities[0];
  const pageMetadata = buildUniversityAdmissionsMetadata(initial);
  const description = String(pageMetadata.description);
  const jsonLdValues = [
    buildAdmissionsWebPageJsonLd({
      id,
      name: `${university.name} 연기 입시 정보`,
      description,
      updatedAt: initial.updated_at,
    }),
    buildAdmissionsBreadcrumbJsonLd(university),
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
      <UniversityDetailPage universityId={id} initial={initial} />
    </>
  );
}
