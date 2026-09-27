"use client";

import { useEffect } from "react";

import {
  APP_DOWNLOAD_ATTR,
  APP_DOWNLOAD_FINAL_STORE_ATTR,
  storeHref,
  type AppStore,
  type StoreLinkSurface,
} from "@/lib/app-download/store-links";
import { useCampaignSearch } from "@/features/app-download/use-campaign-search";

export default function StoreRedirect({
  store,
  surface,
}: {
  store: AppStore;
  surface: StoreLinkSurface;
}) {
  const search = useCampaignSearch();
  const href = storeHref(store, surface, search);

  useEffect(() => {
    // Cloudflare 비컨이 페이지로드를 전송할 틈을 주기 위해 600ms 기다린다.
    const timeoutId = window.setTimeout(() => {
      // replace로 이동해 뒤로 가기가 이 중간 페이지에 다시 걸리지 않게 한다.
      window.location.replace(href);
    }, 600);

    return () => window.clearTimeout(timeoutId);
  }, [href]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-6">
      <div className="text-center">
        <p className="text-base font-semibold text-[#4e5968]">
          스토어로 이동 중이에요.
        </p>
        {/* JS가 안 돌면 useEffect도 안 돈다 — 그때도 막다른 길이 되지 않게 정적 링크를 함께 둔다. */}
        <a
          href={href}
          {...{
            [APP_DOWNLOAD_ATTR]: surface,
            [APP_DOWNLOAD_FINAL_STORE_ATTR]: store,
          }}
          className="mt-3 inline-block text-sm font-semibold text-[#3182f6]"
        >
          바로 이동하기
        </a>
      </div>
    </main>
  );
}
