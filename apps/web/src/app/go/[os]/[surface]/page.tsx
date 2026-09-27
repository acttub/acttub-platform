import {
  buildAppDownloadBootstrapScript,
  STORE_LINK_SURFACES,
  type AppStore,
  type MobileOs,
  type StoreLinkSurface,
} from "@/lib/app-download/store-links";
import { buildNoindexMetadata } from "@/lib/seo/site-metadata";
import StoreRedirect from "./store-redirect";

const MOBILE_OSES = ["ios", "android"] as const satisfies readonly MobileOs[];
const STORE_BY_OS = {
  ios: "app_store",
  android: "google_play",
} as const satisfies Record<MobileOs, AppStore>;

export const metadata = buildNoindexMetadata("스토어로 이동 중");
export const dynamicParams = false;

export function generateStaticParams() {
  return MOBILE_OSES.flatMap((os) =>
    STORE_LINK_SURFACES.map((surface) => ({ os, surface })),
  );
}

export default async function GoToStorePage({
  params,
}: {
  params: Promise<{ os: MobileOs; surface: StoreLinkSurface }>;
}) {
  const { os, surface } = await params;
  return (
    <>
      {/* 하이드레이션 전에 바로 이동 링크도 현재 URL의 안전한 UTM을 보존한다. */}
      <script
        dangerouslySetInnerHTML={{ __html: buildAppDownloadBootstrapScript() }}
      />
      <StoreRedirect store={STORE_BY_OS[os]} surface={surface} />
    </>
  );
}
