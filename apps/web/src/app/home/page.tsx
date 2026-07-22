import { PracticeFlow } from "@/features/practice/practice-flow";
import { buildNoindexMetadata } from "@/lib/seo/site-metadata";

export const metadata = buildNoindexMetadata("연기 연습");

export default function HomePage() {
  return <PracticeFlow entry="home" />;
}
