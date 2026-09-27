import { useAppDownloadHref } from "@/features/app-download/app-download-button";

export function AppDownloadHrefProbe({
  onRender,
}: {
  onRender: (href: string) => void;
}) {
  const href = useAppDownloadHref("landing_hero");
  onRender(href);
  return <output>{href}</output>;
}
