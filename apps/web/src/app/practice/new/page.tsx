import { WorkspaceApp } from "@/features/workspace/workspace-app";
import { buildNoindexMetadata } from "@/lib/seo/site-metadata";

export const metadata = buildNoindexMetadata("새 연습");

// 통합 워크스페이스로 합쳤다 — 새 연습은 워크스페이스의 시작 상태다.
export default function NewPracticePage() {
  return <WorkspaceApp />;
}
