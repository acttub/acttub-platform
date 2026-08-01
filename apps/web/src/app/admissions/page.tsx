import { AdmissionsPage } from "@/features/admissions/admissions-page";
import { buildNoindexMetadata } from "@/lib/seo/site-metadata";

// 저장소 정책상 랜딩 외 페이지는 색인하지 않는다(tests/seo-noindex-guard).
// 이 페이지는 로그인 없이 열리고 검색 유입을 노릴 수 있는 성격이라, 색인을 열지는
// 별도 판단이 필요하다 — 열려면 가드의 예외 목록부터 손봐야 한다.
export const metadata = buildNoindexMetadata("연기 입시 정보");

export default function Page() {
  return <AdmissionsPage />;
}
