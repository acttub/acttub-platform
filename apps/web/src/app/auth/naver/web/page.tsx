import Link from "next/link";
import { WebLogin } from "@/features/auth/web-login";
import { buildNoindexMetadata } from "@/lib/seo/site-metadata";

// 웹 네이버 로그인이 돌아오는 자리(SOMA-834). 앱용 /auth/naver/callback 과 따로 둔다 — 그쪽은 앱 스킴으로 넘긴다.
export const metadata = buildNoindexMetadata("네이버 로그인");

export default function NaverWebCallbackPage() {
  return (
    <div className="min-h-dvh break-keep bg-[#f2f4f6] text-[#191f28]">
      <main className="mx-auto flex max-w-3xl flex-col gap-8 px-5 py-14 sm:px-8">
        <h1 className="text-center text-2xl font-black">네이버로 로그인</h1>
        <WebLogin naverCallback />
        <p className="text-center text-sm text-[#8b95a1]">
          <Link href="/help" className="font-semibold text-[#3182f6]">고객센터</Link>
        </p>
      </main>
    </div>
  );
}
