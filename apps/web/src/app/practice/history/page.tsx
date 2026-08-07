import { WorkspaceApp } from "@/features/workspace/workspace-app";
import { buildNoindexMetadata } from "@/lib/seo/site-metadata";

export const metadata = buildNoindexMetadata("연습 기록");

// 연습 기록은 워크스페이스 왼쪽 세션 바로 흡수됐다.
export default function PracticeHistoryPage() {
  return <WorkspaceApp />;
}
