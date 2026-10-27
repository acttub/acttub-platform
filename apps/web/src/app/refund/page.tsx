import Link from "next/link";
import type { ReactNode } from "react";
import { BusinessInfo } from "@/features/business-info/business-info";
import { ProTopBar } from "@/features/pricing/pro-ui";
import { buildNoindexMetadata } from "@/lib/seo/site-metadata";

export const metadata = buildNoindexMetadata("ACTTUB Pro 해지·환불정책");

const RULES = [
  ["결제 후 7일 이내, 유료 기능을 쓰지 않았을 때", "전액 환불", "bg-[#3182f6] text-white"],
  ["결제 후 7일 이내, 유료 기능을 썼을 때", "이용한 날짜만큼 빼고 환불", "bg-[#e8f3ff] text-[#191f28]"],
  ["결제 후 7일이 지났을 때", "이용한 날짜만큼 빼고, 남은 금액의 10%를 더 빼고 환불", "bg-[#e8f3ff] text-[#191f28]"],
  ["회사 잘못으로 이용하지 못해 해지할 때", "이용한 날짜만큼 빼고, 남은 금액의 10%를 더해서 환불 (최대 결제금액까지)", "bg-[#e8f3ff] text-[#191f28]"],
] as const;

const EXAMPLES = [
  ["쓰지 않고 7일 이내에 해지", "3,900원"],
  ["3일 이용 후 해지", "3,510원"],
  ["10일 이용 후 해지", "2,340원"],
  ["20일 이용 후 해지", "1,170원"],
] as const;

function Section({ id, no, title, children }: { id: string; no: number; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-[28px] bg-white p-6 ring-1 ring-[#e5e8eb] sm:p-8">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#191f28] text-sm font-black text-white">{no}</span>
        <h2 id={id} className="text-xl font-black leading-8 tracking-[-0.02em] sm:text-2xl">{title}</h2>
      </div>
      <div className="mt-5 sm:pl-11">{children}</div>
    </section>
  );
}

export default function RefundPage() {
  return (
    <div className="min-h-dvh break-keep bg-[#f2f4f6] text-[#191f28]">
      <aside className="bg-[#191f28] px-5 py-2.5 text-xs leading-5 text-[#d1d6db] sm:px-8">
        <div className="mx-auto max-w-4xl">
          <span className="mr-2 rounded-full bg-[#3182f6] px-2 py-0.5 text-[11px] font-black text-white">11월 1일 결제 시작</span>
          2026년 11월 1일부터 결제를 시작해요. 아래 1~3은 웹에서 결제한 월 구독에 적용하고, 앱(App Store·Google Play)에서 결제한 구독은 4를 따라요.
        </div>
      </aside>
      <ProTopBar backHref="/pricing" backLabel="ACTTUB Pro 구독 안내" />
      <main className="mx-auto w-full max-w-4xl px-5 pb-14 pt-4 sm:px-8">
        <h1 className="text-[34px] font-black leading-[1.18] tracking-[-0.04em] sm:text-5xl">해지·환불정책</h1>
        <p className="mt-3 text-base font-bold leading-7 text-[#4e5968]">ACTTUB 웹에서 직접 결제한 Pro 월 구독에 적용하는 정책이에요. 앱에서 결제한 구독(월·연)은 4를 봐 주세요.</p>

        <section aria-label="핵심 요약" className="relative mt-7 overflow-hidden rounded-[28px] bg-[#191f28] p-6 text-white shadow-[0_30px_70px_rgba(25,31,40,0.2)] sm:p-8">
          <div className="absolute -right-12 -top-12 h-48 w-48 rounded-full bg-[#3182f6]/40 blur-3xl" />
          <p className="relative text-sm font-black text-[#8fbfff]">핵심 요약</p>
          <ul className="relative mt-4 grid gap-x-8 gap-y-4 text-base font-bold leading-7 sm:grid-cols-2">
            <li>구독료는 월 3,900원이며 부가세가 포함되어 있어요.</li>
            <li>언제든 다음 자동결제를 해지할 수 있어요. 자동결제만 해지하면 현재 결제기간이 끝날 때까지 Pro를 이용할 수 있어요.</li>
            <li>유료 기능을 쓰지 않았다면 결제 후 7일 이내에 전액 환불해요. 이용한 뒤에는 이용한 날짜만큼 빼고 환불해요.</li>
            <li>요청 접수일부터 3영업일 이내에 환급을 처리해요.</li>
          </ul>
        </section>

        <div className="mt-5 space-y-4">
          <Section id="cancel-title" no={1} title="자동결제 해지와 즉시 종료는 달라요">
            <ul className="space-y-3 text-base font-bold leading-7 text-[#4e5968]">
              <li className="border-l-4 border-[#3182f6] pl-4">구독료는 월 3,900원이며 부가세가 포함되어 있어요. 결제주기는 결제일부터 1개월(다음 달 같은 날까지)이에요.</li>
              <li className="border-l-4 border-[#3182f6] pl-4">언제든 다음 자동결제를 해지할 수 있어요. 자동결제만 해지하면 현재 결제기간이 끝날 때까지 Pro를 이용할 수 있어요.</li>
              <li className="border-l-4 border-[#3182f6] pl-4">즉시 이용 종료와 환불을 함께 요청하면 아래 기준에 따라 환불하고 해당 결제주기의 Pro 이용을 종료해요.</li>
              <li className="border-l-4 border-[#3182f6] pl-4">자동결제는 웹사이트 계정 화면이나 고객센터 메일로 해지할 수 있어요.</li>
              <li className="border-l-4 border-[#3182f6] pl-4">구독 해지는 회원 탈퇴와 별개예요. 웹에서 결제한 구독은 탈퇴하면 자동결제가 함께 해지되고 Pro 이용도 끝나요. 남은 기간의 환불은 아래 2의 기준으로 요청할 수 있어요.</li>
            </ul>
          </Section>

          <Section id="refund-title" no={2} title="이용한 날짜만큼 빼고 환불해요">
            <p className="text-base font-bold leading-7 text-[#4e5968]">해당 결제주기의 이용 시작 시각부터 환불 요청 접수 시각까지를 이용일수로 계산해요. 1일은 24시간이고, 24시간이 안 되는 시간도 1일로 계산해요. 하루 이용료는 실제 결제금액을 그 결제주기의 전체 일수로 나눈 금액이에요. 매 결제주기에 같은 기준을 적용해요.</p>
            <dl className="mt-5 grid gap-2 sm:grid-cols-2">
              {RULES.map(([label, rule, tone]) => (
                <div key={label} className={`rounded-2xl p-4 ${tone}`}>
                  <dt className="text-sm font-black leading-5 opacity-80">{label}</dt>
                  <dd className="mt-1 text-lg font-black leading-7">{rule}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-sm font-bold leading-7 text-[#6b7684]">유료 기능은 무료 이용 범위를 넘는 코칭과 대본 보관, 상위 AI 모델·습관을 기억하는 코칭·더 자세한 코칭 노트, 발음 보고서, 리딩 고품질 목소리처럼 Pro로만 쓸 수 있는 기능이에요. 남은 금액은 결제금액에서 이용한 날짜만큼의 금액을 뺀 금액이에요.</p>
            <div className="mt-5 rounded-2xl bg-[#f9fafb] p-4 ring-1 ring-[#e5e8eb]">
              <p className="text-sm font-black text-[#191f28]">결제주기(결제일부터 1개월)가 30일일 때 3,900원을 결제했다면</p>
              <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
                {EXAMPLES.map(([label, won]) => (
                  <div key={label} className="flex items-center justify-between gap-3">
                    <dt className="text-sm font-bold text-[#4e5968]">{label}</dt>
                    <dd className="shrink-0 text-base font-black text-[#191f28]">{won}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <p className="mt-4 text-sm font-bold leading-7 text-[#6b7684]">실제 환불액은 실제 결제금액과 그 결제주기의 일수로 계산하고, 1원 미만은 올려서 환불해요. 이 기준으로 계산한 환불액은 실제 결제금액을 넘지 않아요. 기능 사용 횟수나 생성 결과 수를 이유로 더 공제하지 않아요. 남은 금액의 10% 말고는 위약금이나 환불 수수료를 받지 않아요.</p>
          </Section>

          <Section id="withdrawal-title" no={3} title="법령에 따른 권리는 별도로 보장해요">
            <p className="text-base font-bold leading-7 text-[#4e5968]">유료 기능을 이용하지 않았다면 계약 내용을 받은 날부터 7일 이내에 전액 환불을 요청할 수 있어요. 서비스 제공이 더 늦게 시작됐다면 제공이 시작된 날부터 계산해요.</p>
            <p className="mt-3 text-base font-bold leading-7 text-[#4e5968]">유료 기능을 쓰기 시작하면 이미 이용한 날짜만큼은 청약철회가 되지 않아요. 결제 전에 코칭과 리딩을 무료로 먼저 써 볼 수 있고, Pro 전용 기능은 구독 안내 페이지에서 화면과 설명으로 미리 확인할 수 있어요.</p>
            <p className="mt-3 text-base font-bold leading-7 text-[#4e5968]">서비스 미제공, 표시·광고와 다른 제공, 회사의 귀책사유 등으로 관계 법령에 따른 청약철회·해제·해지·환급·보상 권리가 이 정책보다 유리하면 해당 권리를 우선 보장해요. 법정 청약철회 기간과 권리를 이 정책으로 제한하지 않아요.</p>
          </Section>

          <Section id="app-title" no={4} title="앱에서 결제한 구독은 스토어 절차를 따라요">
            <ul className="space-y-3 text-base font-bold leading-7 text-[#4e5968]">
              <li className="border-l-4 border-[#3182f6] pl-4">앱에서는 월 구독(3,900원)과 연 구독(32,500원)을 팔아요. 연 구독은 앱에서만 팔고, 해지와 환불은 각 스토어 절차를 따라요.</li>
              <li className="border-l-4 border-[#3182f6] pl-4">iOS(App Store): 청구·영수증·해지·환불은 Apple이 처리해요. 회사는 Apple 결제를 직접 환불할 수 없어서, 환불은 Apple에 요청해 주세요. 해지는 설정 &gt; Apple 계정 &gt; 구독에서 할 수 있어요.</li>
              <li className="border-l-4 border-[#3182f6] pl-4">Android(Google Play): Google Play에 환불을 요청하거나 고객센터로 요청할 수 있어요. 고객센터로 요청하면 Google Play가 허용하는 범위에서 회사가 처리해요. 해지는 Play 스토어 &gt; 결제 및 정기 결제 &gt; 정기 결제에서 할 수 있어요.</li>
              <li className="border-l-4 border-[#3182f6] pl-4">앱을 지우거나 회원을 탈퇴해도 스토어 구독은 해지되지 않아요. 탈퇴하기 전에 스토어에서 먼저 해지해 주세요.</li>
              <li className="border-l-4 border-[#3182f6] pl-4">한 계정은 한 곳(웹·App Store·Google Play 중 하나)에서만 구독할 수 있어요.</li>
            </ul>
          </Section>
          <Section id="contact-title" no={5} title="해지·환불 요청 방법">
            <p className="text-base font-bold leading-7 text-[#4e5968]">고객센터 <a href="mailto:acttub0527@gmail.com" className="text-[#3182f6] underline underline-offset-4">acttub0527@gmail.com</a>으로 결제한 계정을 식별할 수 있는 정보와 결제일, 요청 내용을 보내주세요. 비밀번호나 카드번호 전체를 보내지 마세요.</p>
            <p className="mt-3 text-base font-bold leading-7 text-[#4e5968]">요청 접수일부터 3영업일 이내에 환급을 처리해요. 카드 결제는 지체 없이 결제 취소를 요청하며, 실제 반영 시점은 카드사에 따라 다를 수 있어요. 회사가 요청을 확인한 시각이 늦어져도 환불 금액은 요청 접수 시각을 기준으로 계산해요.</p>
          </Section>
        </div>
      </main>
      <footer className="border-t border-[#e5e8eb] bg-white px-5 py-8 text-sm font-bold text-[#3182f6] sm:px-8">
        <div className="mx-auto flex max-w-4xl flex-wrap gap-x-5 gap-y-2">
          <Link href="/pricing" className="underline underline-offset-4">상품·가격 안내</Link>
          <Link href="/terms" className="underline underline-offset-4">이용약관</Link>
          <Link href="/privacy" className="underline underline-offset-4">개인정보 처리방침</Link>
          <Link href="/" className="underline underline-offset-4">ACTTUB 홈</Link>
          <div className="basis-full pt-2 font-normal"><BusinessInfo /></div>
        </div>
      </footer>
    </div>
  );
}
