import { MemoryPanel } from "@/features/memory/memory-panel";
import { buildNoindexMetadata } from "@/lib/seo/site-metadata";

// 로그인해야 열리는 화면이라 색인 대상이 아니다(tests/seo-noindex-guard).
export const metadata = buildNoindexMetadata("코치가 기억하는 것");

export default function Page() {
  return <MemoryPanel />;
}
