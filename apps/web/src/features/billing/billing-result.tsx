"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";

import { fetchBillingMe } from "@/lib/api/v2/billing";
import { resultViewOf, returnStatusOf } from "./billing-flow";

const subscribe = () => () => {};
const readSearch = () => window.location.search;
const serverSearch = () => "";

/** 카드 등록·첫 결제 뒤 서버가 보내 준 결과 화면 (SOMA-818). 주소의 status 는 참고만 하고 결제 성립은 서버 상태로 본다. */
export function BillingResultApp() {
  const status = returnStatusOf(useSyncExternalStore(subscribe, readSearch, serverSearch));
  const [pro, setPro] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchBillingMe({ signal: controller.signal })
      .then((me) => setPro(me.pro && me.status === "active"))
      .catch(() => setPro(false));
    return () => controller.abort();
  }, []);

  const view = resultViewOf(status, pro);
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center px-6 text-center text-[#191f28]">
      <h1 className="text-2xl font-black">{view.title}</h1>
      <p className="mt-3 text-base font-bold leading-7 text-[#4e5968]">{view.body}</p>
      <Link href="/pricing" className="mt-8 inline-flex h-12 items-center rounded-2xl bg-[#3182f6] px-6 text-base font-black text-white">
        ACTTUB Pro 안내로 돌아가기
      </Link>
    </main>
  );
}
