import { HelpCenter } from "@/features/help/help-center";
import { buildNoindexMetadata } from "@/lib/seo/site-metadata";

export const metadata = buildNoindexMetadata("고객센터");

export default function HelpPage() {
  return <HelpCenter />;
}
