import Link from "next/link";

import { buildNoindexMetadata } from "@/lib/seo/site-metadata";

export const metadata = buildNoindexMetadata("페이지를 찾을 수 없어요");

const links = [
  { href: "/", label: "홈" },
  { href: "/app", label: "앱 다운로드" },
  { href: "/ai-acting-coaching", label: "AI 연기 코칭" },
  { href: "/acting-coaching", label: "연기 코칭 안내" },
] as const;

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center bg-[#f2f4f6] px-5 py-16 text-[#191f28]">
      <section className="mx-auto w-full max-w-xl rounded-[32px] bg-white p-7 sm:p-12">
        <p className="text-sm font-black text-[#3182f6]">404</p>
        <h1 className="mt-3 text-4xl font-black tracking-[-0.05em] sm:text-5xl">
          페이지를 찾을 수 없어요
        </h1>
        <p className="mt-5 text-base font-semibold leading-8 text-[#4e5968] sm:text-lg">
          주소가 달라졌거나 페이지가 사라졌어요. 아래 링크에서 다시 시작해 보세요.
        </p>
        <nav className="mt-8 grid gap-3 sm:grid-cols-2">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-2xl bg-[#f2f4f6] px-5 py-4 font-black transition hover:bg-[#e8f3ff] hover:text-[#3182f6]"
            >
              {link.label} →
            </Link>
          ))}
        </nav>
      </section>
    </main>
  );
}
