import { WorkspaceApp } from "@/features/workspace/workspace-app";
import { buildNoindexMetadata } from "@/lib/seo/site-metadata";

export const metadata = buildNoindexMetadata("연기 연습");

// 홈·새 연습·연습 기록·세션 상세를 통합 워크스페이스 하나로 합쳤다. 세 라우트가 같은 화면을
// 렌더하고, 어느 세션을 여는지는 ?session= 이 정한다.
// 되돌리려면 이 import 를 PracticeFlow entry="home" 으로 돌리면 된다 (practice-flow.tsx는 남겨 뒀다).
export default function HomePage() {
  return <WorkspaceApp />;
}
