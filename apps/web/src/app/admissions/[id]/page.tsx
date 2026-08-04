import { UniversityDetailPage } from "@/features/admissions/university-detail";
import { universityIds } from "@/features/admissions/university-ids";
import { buildNoindexMetadata } from "@/lib/seo/site-metadata";

// 목록과 같은 정책. 색인을 열려면 tests/seo-noindex-guard의 예외 목록부터 손봐야 한다.
export const metadata = buildNoindexMetadata("연기 입시 정보");

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
  return <UniversityDetailPage universityId={id} />;
}
