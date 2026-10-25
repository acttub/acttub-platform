import Link from "next/link";
import { WebLogin } from "@/features/auth/web-login";
import { buildNoindexMetadata } from "@/lib/seo/site-metadata";

export const metadata = buildNoindexMetadata("로그인");

/** 웹 회원 로그인(account.login, SOMA-834). 로그인하지 않아도 웹은 게스트로 그대로 쓸 수 있다. */
export default function LoginPage() {
  return (
    <div className="min-h-dvh break-keep bg-[#f2f4f6] text-[#191f28]">
      <main className="mx-auto flex max-w-3xl flex-col gap-8 px-5 py-14 sm:px-8">
        <Link href="/home" className="text-sm font-semibold text-[#4e5968]">← 연습으로 돌아가기</Link>
        <div className="text-center">
          <h1 className="text-3xl font-black tracking-[-0.03em]">앱 계정으로 로그인</h1>
          <p className="mt-3 text-base leading-7 text-[#4e5968]">앱에서 쓰던 계정 그대로 웹에서도 이어서 써요.</p>
        </div>
        <WebLogin />
        <p className="text-center text-sm text-[#8b95a1]">
          로그인이 안 되나요? <Link href="/help" className="font-semibold text-[#3182f6]">고객센터</Link>
        </p>
      </main>
    </div>
  );
}
