import { PostDetailRoute } from "@/features/community/post-detail";
import { buildNoindexMetadata } from "@/lib/seo/site-metadata";

export const metadata = buildNoindexMetadata("커뮤니티 글");

export default function Page() {
  return <PostDetailRoute />;
}
