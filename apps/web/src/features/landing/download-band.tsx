import { StoreBadges } from "@/features/app-download/store-badges";

import { Acty, Qr } from "./shared";

/** 맨 아래 다운로드. 액티는 여기서 한 번 더 나온다(첫 화면과 여기, 두 번만). */
export function DownloadBand() {
  return (
    <section aria-labelledby="band-title" className="bg-[#fff6e6] px-5 pb-16 sm:px-8 lg:pb-24">
      <div data-reveal className="relative mx-auto flex max-w-[1200px] flex-col gap-8 overflow-hidden rounded-[40px] bg-[#151a30] px-7 py-12 text-white lg:flex-row lg:items-center lg:gap-10 lg:px-16 lg:py-14">
        <div className="flex-1">
          <h2 id="band-title" className="text-[clamp(32px,5vw,60px)] font-black leading-[1.1] tracking-[-0.055em]">
            오늘 찍은 연기,
            <br />
            <span className="text-[#ffa21f]">코치와 같이 봐요</span>
          </h2>
          <p className="mt-3 text-base text-[#d5d9e6] sm:text-lg">
            앱은 무료예요.<span className="hidden lg:inline"> 휴대폰 카메라로 QR을 찍어 주세요.</span>
          </p>
          <StoreBadges surface="landing_cta" className="mt-7" />
        </div>
        <div className="hidden lg:block">
          <Qr size={136} />
        </div>
        <Acty name="cheer" alt="" size={200} className="w-[120px] self-end lg:w-[200px] lg:self-center" />
      </div>
    </section>
  );
}
