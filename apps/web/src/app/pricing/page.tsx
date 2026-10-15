import Link from "next/link";
import { buildNoindexMetadata } from "@/lib/seo/site-metadata";

export const metadata = buildNoindexMetadata("ACTTUB Pro 구독 안내");

export default function PricingPage() {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-3xl px-6 py-12 sm:py-16">
      <Link href="/" className="text-sm font-semibold text-[#3182f6]">ACTTUB 홈</Link>
      <h1 className="mt-5 text-3xl font-bold tracking-[-0.03em] text-[#191f28]">ACTTUB Pro 구독 안내</h1>
      <p className="mt-3 text-base leading-7 text-[#4e5968]">혼자 하는 연기 연습을 더 자주, 더 자세히 살펴봐요.</p>
      <section aria-labelledby="launch-title" className="mt-8 rounded-2xl bg-[#f2f4f6] p-5 text-sm leading-7 text-[#4e5968]">
        <h2 id="launch-title" className="font-bold text-[#191f28]">아직 결제를 받지 않아요</h2>
        <p>아래 내용은 출시를 준비 중인 요금제예요. 현재 서비스는 기존 무료 이용 방식으로 제공하고 있으며, 아래 무료 한도와 Pro 전용 기능은 아직 적용하지 않았어요.</p>
        <p className="mt-2">기능 준비 목표는 2026년 10월 22일이며, 유료 구독은 11월 도입을 준비하고 있어요. 기능 준비일은 결제 시작일이 아니에요. 정확한 판매 시작일은 별도로 안내해요.</p>
      </section>
      <section aria-labelledby="pro-title" className="mt-8 rounded-3xl border border-[#e5e8eb] bg-white p-6 sm:p-8">
        <p className="text-sm font-semibold text-[#3182f6]">출시 예정</p>
        <h2 id="pro-title" className="mt-2 text-2xl font-bold text-[#191f28]">ACTTUB Pro</h2>
        <p className="mt-4 text-4xl font-bold tracking-tight text-[#191f28]">월 3,900원</p>
        <p className="mt-2 text-sm text-[#6b7684]">부가세 포함 · 결제일부터 1개월 · 매월 정기결제</p>
        <ul className="mt-6 list-disc space-y-3 pl-5 text-base leading-7 text-[#4e5968]">
          <li>AI 연기 코칭을 횟수 제한 없이 이용해요.</li>
          <li>리딩 대본을 개수 제한 없이 보관하고, 원하는 대본으로 반복 연습해요.</li>
          <li>리딩에서 발음·딕션 피드백을 확인해요. 이 기능은 Pro 전용으로 준비 중이에요.</li>
          <li>챌린지 참여작·댓글·프로필에 Pro 배지를 표시해요. 구독 표시이며 배우의 실력이나 자격을 인증하는 표시는 아니에요.</li>
        </ul>
        <p className="mt-6 rounded-2xl bg-[#f9fafb] p-4 text-sm leading-6 text-[#6b7684]">아직 구독 신청과 결제를 받지 않아요. 현재 무료 이용자가 동의 없이 유료로 전환되지는 않아요.</p>
      </section>
      <section aria-labelledby="free-title" className="mt-8 border-t border-[#e5e8eb] pt-8">
        <h2 id="free-title" className="text-xl font-bold text-[#191f28]">출시 후 무료 이용 범위</h2>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-base leading-7 text-[#4e5968]">
          <li>코칭은 하루 1회 이용해요.</li>
          <li>리딩 대본은 동시에 1개 보관해요. 삭제 후 다른 대본으로 교체할 수 있고, 같은 대본의 반복 연습에는 횟수 제한이 없어요.</li>
          <li>챌린지 참여·시청·댓글은 무료로 이용해요.</li>
        </ul>
        <p className="mt-4 text-sm leading-6 text-[#6b7684]">무료와 Pro는 같은 코치와 리딩 음성 품질을 제공해요. 발음·딕션 피드백은 Pro 전용이에요. 현재 무료 이용 범위의 변경 시점과 기존 이용자 적용 방법은 판매 시작 전에 안내해요.</p>
      </section>
      <section aria-labelledby="billing-title" className="mt-8 border-t border-[#e5e8eb] pt-8">
        <h2 id="billing-title" className="text-xl font-bold text-[#191f28]">결제와 해지</h2>
        <p className="mt-4 text-base leading-7 text-[#4e5968]">웹에서 신청하는 월 정기결제 상품으로 준비하고 있어요. 언제든 다음 자동결제를 해지할 수 있고, 구독 해지는 회원 탈퇴와 별개예요. 이용 후에도 해당 결제주기의 이용기간에 따라 환불해요.</p>
        <Link href="/refund" className="mt-4 inline-block text-sm font-semibold text-[#3182f6] underline underline-offset-4">기간별 환불 비율과 요청 방법 보기</Link>
      </section>
      <footer className="mt-10 border-t border-[#e5e8eb] pt-6 text-sm leading-7 text-[#6b7684]">
        <p>판매자: 액터브(ACTTUB) · 사업자등록번호: 796-11-03104</p>
        <p>문의: <a href="mailto:acttub0527@gmail.com" className="underline underline-offset-4">acttub0527@gmail.com</a></p>
        <Link href="/terms" className="mt-3 inline-block text-[#3182f6] underline underline-offset-4">이용약관·개인정보 처리방침</Link>
      </footer>
    </main>
  );
}
