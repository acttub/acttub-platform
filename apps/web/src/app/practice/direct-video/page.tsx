import { buildNoindexMetadata } from "@/lib/seo/site-metadata";
import { DirectVideoExperiment } from "@/features/coach/direct-video-experiment";
import { notFound } from "next/navigation";

export const metadata = buildNoindexMetadata("영상 직접 대화 테스트");

export default function Page() {
  if (process.env.NEXT_PUBLIC_SITE_URL !== "https://dev.acttub.com") notFound();
  return <DirectVideoExperiment />;
}
