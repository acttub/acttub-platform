import { buildNoindexMetadata } from "@/lib/seo/site-metadata";
import PracticeRedirect from "./practice-redirect";

export const metadata = buildNoindexMetadata("연기 연습");

export default function LegacyPracticePage() {
  return <PracticeRedirect />;
}
