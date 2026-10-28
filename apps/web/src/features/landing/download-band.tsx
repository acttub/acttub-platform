import { StoreBadges } from "@/features/app-download/store-badges";

import { Acty, Grain, Qr, SERIF } from "./shared";

/** 맨 아래 다운로드. 막이 내리는 자리라 액티가 커튼 뒤에서 내다본다. */
export function DownloadBand() {
  return (
    <section aria-labelledby="band-title" className="relative overflow-hidden bg-[#14110e] text-[#f2ebe0]">
      <Grain />
      <div data-reveal className="relative mx-auto max-w-[1200px] px-6 py-24 sm:px-8 lg:py-32">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <h2 id="band-title" className={`${SERIF} text-[clamp(32px,4.6vw,60px)] leading-[1.2]`}>
              오늘 찍은 연기,
              <br />
              코치와 같이 봐요
            </h2>
            <p className="mt-5 text-[17px] leading-[1.7] text-[#b8ad9e]">
              앱은 무료예요.<span className="hidden lg:inline"> 휴대폰 카메라로 QR을 찍어 주세요.</span>
            </p>
            <div className="mt-9 flex items-center gap-6">
              <div className="hidden lg:block">
                <Qr size={92} />
              </div>
              <StoreBadges surface="landing_cta" />
            </div>
          </div>
          <Acty pose="curtain" width={124} className="w-[96px] justify-self-end lg:w-[124px]" />
        </div>
      </div>
    </section>
  );
}
