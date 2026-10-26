import { HelpCenter } from "@/features/help/help-center";
import { buildHelpMetadata } from "@/lib/seo/site-metadata";

export const metadata = buildHelpMetadata();

export default function HelpPage() {
  return <HelpCenter />;
}
