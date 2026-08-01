import { PostComposerRoute } from "@/features/community/post-composer";
import { buildNoindexMetadata } from "@/lib/seo/site-metadata";

export const metadata = buildNoindexMetadata("글쓰기");

export default function Page() {
  return <PostComposerRoute />;
}
