import Image from "next/image";
import Link from "next/link";

import wordmark from "@/assets/acttub-wordmark.png";
import type { PublicEntryLookup } from "@/lib/api/v2/public-entry";

import { ENTRY_FAILED_COPY, ENTRY_NOT_FOUND_COPY } from "./entry-share";
import { OpenInAppButton } from "./open-in-app-button";

/**
 * 참여작 공유 페이지(challenge.share). 영상은 여기서 틀지 않는다 — 작품·대사만 보여 주고 앱으로 보낸다.
 * 작성자의 이름·사진은 서버 응답에도 없다.
 */
export function EntrySharePage({
  entryId,
  lookup,
}: {
  entryId: string;
  lookup: PublicEntryLookup;
}) {
  if (lookup.kind === "not_found") {
    return (
      <EntryShell>
        <h1 className="text-2xl font-black tracking-[-0.04em]">{ENTRY_NOT_FOUND_COPY.title}</h1>
        <p className="mt-3 text-base font-semibold leading-7 text-[#4e5968]">
          {ENTRY_NOT_FOUND_COPY.body}
        </p>
        <Link
          href="/app"
          className="mt-8 flex h-14 w-full items-center justify-center rounded-2xl bg-[#f2f4f6] text-base font-bold text-[#333d4b]"
        >
          액터브 앱 받기
        </Link>
      </EntryShell>
    );
  }

  if (lookup.kind === "failed") {
    return (
      <EntryShell>
        <h1 className="text-2xl font-black tracking-[-0.04em]">{ENTRY_FAILED_COPY.title}</h1>
        <p className="mt-3 text-base font-semibold leading-7 text-[#4e5968]">
          {ENTRY_FAILED_COPY.body}
        </p>
        <div className="mt-8">
          <OpenInAppButton entryId={entryId} />
        </div>
      </EntryShell>
    );
  }

  const { entry } = lookup;
  return (
    <EntryShell>
      <p className="text-sm font-bold text-[#3182f6]">액터브 챌린지</p>
      <h1 className="mt-2 break-words text-[26px] font-black tracking-[-0.04em]">
        {entry.work}
        {entry.character ? (
          <span className="ml-2 text-lg font-bold text-[#6b7684]">{entry.character} 역</span>
        ) : null}
      </h1>
      <blockquote className="mt-5 whitespace-pre-wrap break-words rounded-2xl bg-[#f9fafb] px-5 py-4 text-lg font-semibold leading-8 text-[#333d4b]">
        “{entry.line}”
      </blockquote>
      <div className="mt-8">
        <OpenInAppButton entryId={entryId} />
      </div>
      <p className="mt-3 text-center text-sm font-semibold text-[#8b95a1]">
        앱이 없으면 스토어로 이동해요
      </p>
    </EntryShell>
  );
}

function EntryShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-[#f2f4f6] text-[#191f28]">
      <header className="border-b border-[#edf0f3] bg-white px-5">
        <nav className="mx-auto flex h-14 max-w-md items-center">
          <Link href="/" aria-label="Acttub 홈" className="shrink-0">
            <Image src={wordmark} alt="Acttub" className="h-5 w-auto" />
          </Link>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-md px-5 py-10">
        <section className="rounded-[28px] bg-white p-7">{children}</section>
      </main>
    </div>
  );
}
