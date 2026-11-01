import Link from "next/link";
import { AccountView } from "@/features/account/account-view";
import { SiteFooter, SiteHeader } from "@/features/site/site-chrome";
import { buildNoindexMetadata } from "@/lib/seo/site-metadata";

export const metadata = buildNoindexMetadata("내 계정·계정 삭제 안내");

/**
 * 내 계정과 계정 삭제 안내(SOMA-834). 삭제 안내는 Google Play의 계정 삭제 URL로 쓸 수 있게 로그인 없이
 * 누구에게나 보인다. 로그인한 회원에게는 위에 내 계정(구독·문의·로그아웃·탈퇴)이 더 보인다.
 */
export default function AccountPage() {
  return (
    <div className="min-h-dvh break-keep bg-white text-[#191f28]">
      <SiteHeader current="home" />
      <main className="mx-auto max-w-[720px] px-5 pb-24 pt-14 sm:px-8 sm:pt-20">
        <h1 className="text-[34px] font-black tracking-[-0.03em]">내 계정</h1>
        <div className="mt-10">
          <AccountView />
        </div>

        <section aria-labelledby="delete" className="mt-16 border-t border-[#edf0f3] pt-10">
          <h2 id="delete" className="scroll-mt-24 text-xl font-black">ACTTUB 계정 삭제 안내</h2>
          <h3 className="mt-6 text-base font-extrabold">앱이나 웹에서 삭제하기</h3>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-[15px] leading-7 text-[#4e5968]">
            <li>ACTTUB 앱을 열고 로그인해요.</li>
            <li>프로필 탭에서 설정으로 들어가요.</li>
            <li>회원 탈퇴를 누르고 한 번 더 확인해요.</li>
          </ol>
          <p className="mt-3 text-[15px] leading-7 text-[#4e5968]">
            웹에서는 <Link href="/login?next=/account" className="font-semibold text-[#3182f6]">로그인</Link>한 뒤 이 화면 아래쪽의 회원 탈퇴에서 할 수 있어요.
          </p>
          <p className="mt-3 text-[15px] leading-7 text-[#4e5968]">
            앱을 쓸 수 없으면 가입한 로그인 방식(구글·애플·카카오·네이버)과 함께{" "}
            <Link href="/help/contact" className="font-semibold text-[#3182f6]">문의하기</Link>로 삭제를 요청해 주세요.
          </p>
          <h3 className="mt-8 text-base font-extrabold">삭제하면 이렇게 돼요</h3>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-[15px] leading-7 text-[#4e5968]">
            <li>이메일, 프로필 이름·사진·소개, 포트폴리오, 로그인 연결 정보가 바로 지워져요.</li>
            <li>연습 기록과 챌린지 댓글처럼 다른 사람 화면에 얽힌 기록은 누구 것인지 알 수 없게 끊어서 남겨요.</li>
            <li>삭제한 계정은 되돌릴 수 없어요. 같은 방법으로 다시 가입하면 새 계정이 되고, 이전 기록은 옮겨지지 않아요.</li>
            <li className="font-semibold text-[#191f28]">탈퇴해도 App Store·Google Play 구독은 자동으로 해지되지 않아요. 각 스토어의 구독 관리에서 먼저 해지해 주세요.</li>
          </ul>
        </section>
      </main>
      <SiteFooter showBadges={false} />
    </div>
  );
}
