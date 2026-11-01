import Image from "next/image";
import Link from "next/link";

import wordmark from "@/assets/acttub-wordmark.png";

/** 가입·로그인 화면의 바깥틀. 왼쪽에 앱 화면 하나(넓은 화면만), 오른쪽에 흐름. 상단은 로고와 고객센터만 둔다. */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col break-keep bg-white text-[#191f28]">
      <header className="border-b border-[#edf0f3]">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-5 sm:h-[72px] sm:px-8">
          <Link href="/?intro=1" aria-label="ACTTUB 홈">
            <Image src={wordmark} alt="Acttub" priority className="h-6 w-auto sm:h-7" />
          </Link>
          <Link href="/help" className="text-[15px] font-semibold text-[#4e5968]">고객센터</Link>
        </div>
      </header>
      <div className="flex flex-1">
        <aside aria-hidden="true" className="hidden w-[36%] items-center justify-center bg-[#f2f4f6] lg:flex">
          <div className="w-[260px] rounded-[44px] bg-[#16181d] p-2.5 shadow-[0_30px_60px_rgba(25,31,40,0.18)]">
            <Image src="/site/shot-note.jpg" alt="" width={390} height={844} className="block h-auto w-full rounded-[34px] bg-white" />
          </div>
        </aside>
        <main className="flex flex-1 items-start justify-center px-5 py-12 sm:px-8 lg:items-center lg:py-16">{children}</main>
      </div>
    </div>
  );
}
