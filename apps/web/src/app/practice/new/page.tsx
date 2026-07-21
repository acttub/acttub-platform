import { PracticeSingle } from "@/features/practice/practice-single";
import { buildNoindexMetadata } from "@/lib/seo/site-metadata";

export const metadata = buildNoindexMetadata("새 연습");

export default function NewPracticePage() {
  return <PracticeSingle />;
}
