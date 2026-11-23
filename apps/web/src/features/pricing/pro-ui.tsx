import Image from "next/image";
import Link from "next/link";

import wordmark from "@/assets/acttub-wordmark.png";

/** Pro 안내·환불 페이지 공용 머리. 색은 홈 랜딩(landing-client.tsx)과 맞춘다. */

export function ProTopBar({ backHref, backLabel }: { backHref: string; backLabel: string }) {
  return (
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
      <Link href="/" aria-label="ACTTUB 홈">
        <Image src={wordmark} alt="Acttub" className="h-6 w-auto" priority />
      </Link>
      <Link
        href={backHref}
        className="inline-flex h-9 items-center rounded-full border border-[#d1d6db] bg-white px-4 text-sm font-black text-[#191f28] transition hover:bg-[#f2f4f6]"
      >
        {backLabel}
      </Link>
    </header>
  );
}
