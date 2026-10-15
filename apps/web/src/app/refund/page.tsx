import Link from "next/link";
import { buildNoindexMetadata } from "@/lib/seo/site-metadata";

export const metadata = buildNoindexMetadata("ACTTUB Pro 해지·환불정책");

export default function RefundPage() {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-3xl px-6 py-12 sm:py-16">
      <Link href="/pricing" className="text-sm font-semibold text-[#3182f6]">ACTTUB Pro 구독 안내</Link>
      <h1 className="mt-5 text-3xl font-bold tracking-[-0.03em] text-[#191f28]">해지·환불정책</h1>
      <p className="mt-3 text-base leading-7 text-[#4e5968]">ACTTUB 웹에서 직접 결제한 Pro 월 구독에 적용하는 정책이에요.</p>
      <p className="mt-6 rounded-2xl bg-[#f2f4f6] p-5 text-sm leading-7 text-[#4e5968]">현재는 판매 시작 전이며 결제를 받지 않아요. 이 정책은 Pro 유료 판매가 시작된 뒤의 웹 결제에 적용해요. 앱스토어에서 결제한 상품의 정책을 뜻하지는 않아요.</p>
      <section aria-labelledby="cancel-title" className="mt-8">
        <h2 id="cancel-title" className="text-xl font-bold text-[#191f28]">1. 자동결제 해지와 즉시 종료는 달라요</h2>
        <ul className="mt-4 list-disc space-y-3 pl-5 text-base leading-7 text-[#4e5968]">
          <li>구독료는 월 3,900원이며 부가세가 포함되어 있어요. 이용기간은 각 결제주기 시작일부터 1개월이에요.</li>
          <li>언제든 다음 자동결제를 해지할 수 있어요. 자동결제만 해지하면 현재 결제기간이 끝날 때까지 Pro를 이용할 수 있어요.</li>
          <li>즉시 이용 종료와 환불을 함께 요청하면 아래 기준에 따라 환불하고 해당 결제주기의 Pro 이용을 종료해요.</li>
          <li>구독 해지는 회원 탈퇴와 별개예요.</li>
        </ul>
      </section>
      <section aria-labelledby="refund-title" className="mt-8 border-t border-[#e5e8eb] pt-8">
        <h2 id="refund-title" className="text-xl font-bold text-[#191f28]">2. 이용한 뒤에도 기간에 따라 환불해요</h2>
        <p className="mt-4 text-base leading-7 text-[#4e5968]">해당 결제주기의 이용 시작 시각부터 환불 요청 접수 시각까지를 기준으로 계산해요. 1일은 24시간이며 매 결제주기에 같은 기준을 적용해요.</p>
        <dl className="mt-5 divide-y divide-[#e5e8eb] rounded-2xl border border-[#e5e8eb] bg-white px-5">
          <div className="flex flex-wrap items-center justify-between gap-2 py-5"><dt className="text-base font-semibold text-[#191f28]">이용 시작 후 7일 이내</dt><dd className="text-base font-bold text-[#3182f6]">100% · 3,900원</dd></div>
          <div className="flex flex-wrap items-center justify-between gap-2 py-5"><dt className="text-base font-semibold text-[#191f28]">7일 초과 ~ 14일 이내</dt><dd className="text-base font-bold text-[#3182f6]">80% · 3,120원</dd></div>
          <div className="flex flex-wrap items-center justify-between gap-2 py-5"><dt className="text-base font-semibold text-[#191f28]">14일 초과 ~ 21일 이내</dt><dd className="text-base font-bold text-[#3182f6]">60% · 2,340원</dd></div>
          <div className="flex flex-wrap items-center justify-between gap-2 py-5"><dt className="text-base font-semibold text-[#191f28]">21일 초과 ~ 이용기간 종료 전</dt><dd className="text-base font-bold text-[#3182f6]">40% · 1,560원</dd></div>
        </dl>
        <p className="mt-4 text-sm leading-7 text-[#6b7684]">표시 금액은 3,900원을 결제한 경우예요. 환불 비율은 실제 결제금액에 적용하며, 기능 사용 횟수나 생성 결과 수를 이유로 추가 공제하지 않아요. 별도의 위약금이나 환불 수수료도 부과하지 않아요.</p>
      </section>
      <section aria-labelledby="withdrawal-title" className="mt-8 border-t border-[#e5e8eb] pt-8">
        <h2 id="withdrawal-title" className="text-xl font-bold text-[#191f28]">3. 법령에 따른 권리는 별도로 보장해요</h2>
        <p className="mt-4 text-base leading-7 text-[#4e5968]">유료 기능을 이용하지 않았다면 계약 내용을 받은 날부터 7일 이내에 전액 환불을 요청할 수 있어요. 서비스 제공이 더 늦게 시작됐다면 제공이 시작된 날부터 계산해요.</p>
        <p className="mt-3 text-base leading-7 text-[#4e5968]">위 구간별 환불은 ACTTUB이 추가로 제공하는 자율 정책이에요. 서비스 미제공, 표시·광고와 다른 제공, 회사의 귀책사유 등으로 관계 법령에 따른 청약철회·해제·해지·환급·보상 권리가 더 유리하면 해당 권리를 우선 보장해요. 법정 청약철회 기간과 권리를 이 정책으로 제한하지 않아요.</p>
      </section>
      <section aria-labelledby="contact-title" className="mt-8 border-t border-[#e5e8eb] pt-8">
        <h2 id="contact-title" className="text-xl font-bold text-[#191f28]">4. 해지·환불 요청 방법</h2>
        <p className="mt-4 text-base leading-7 text-[#4e5968]">고객센터 <a href="mailto:acttub0527@gmail.com" className="text-[#3182f6] underline underline-offset-4">acttub0527@gmail.com</a>으로 결제한 계정을 식별할 수 있는 정보와 결제일, 요청 내용을 보내주세요. 비밀번호나 카드번호 전체를 보내지 마세요.</p>
        <p className="mt-3 text-base leading-7 text-[#4e5968]">요청 접수일부터 3영업일 이내에 환급을 처리해요. 카드 결제는 지체 없이 결제 취소를 요청하며, 실제 반영 시점은 카드사에 따라 다를 수 있어요. 회사가 요청을 확인한 시각이 늦어져도 환불 구간은 요청 접수 시각을 기준으로 정해요.</p>
      </section>
      <footer className="mt-10 flex flex-wrap gap-x-5 gap-y-2 border-t border-[#e5e8eb] pt-6 text-sm text-[#3182f6]">
        <Link href="/pricing" className="underline underline-offset-4">상품·가격 안내</Link>
        <Link href="/terms" className="underline underline-offset-4">이용약관·개인정보 처리방침</Link>
        <Link href="/" className="underline underline-offset-4">ACTTUB 홈</Link>
      </footer>
    </main>
  );
}
