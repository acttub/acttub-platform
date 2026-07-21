import { PracticeFlow } from "@/features/practice/practice-flow";
import { buildNoindexMetadata } from "@/lib/seo/site-metadata";

export const metadata = buildNoindexMetadata("연습 기록");

export default function PracticeHistoryPage() {
  return <PracticeFlow entry="history" />;
}
