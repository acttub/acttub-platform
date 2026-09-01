import Image from "next/image";

import {
  goHref,
  STORE_ORDER,
  type AppStore,
  type StoreLinkSurface,
} from "@/lib/app-download/store-links";

// 애플·구글이 배포하는 한국어 공식 배지를 그대로 쓴다(직접 그린 대체 배지는 두 회사의
// 브랜드 지침 위반). 원본 비율은 App Store 129.7:40, Google Play 646:192이고,
// Google 배지는 원본 PNG에 들어 있던 위아래 투명 여백을 잘라내 두 배지의 검은 상자
// 높이가 같아지게 맞췄다. 지침이 요구하는 여백은 CSS gap으로 확보한다.
const BADGE_ART: Record<
  AppStore,
  { src: string; alt: string; aspect: number }
> = {
  app_store: {
    src: "/badges/app-store-ko.svg",
    alt: "App Store에서 다운로드",
    aspect: 129.70071 / 40,
  },
  google_play: {
    src: "/badges/google-play-ko.png",
    alt: "Google Play에서 다운로드",
    aspect: 646 / 192,
  },
};

const BADGE_HEIGHT = { md: 44, lg: 54 } as const;

export type StoreBadgeSize = keyof typeof BADGE_HEIGHT;

/**
 * 두 스토어 배지를 나란히 건다. 새 탭을 열지 않는다 — 유입의 대부분이 인스타그램 인앱
 * 브라우저이고 거기서는 새 탭 요청이 막히는 경우가 있다. 같은 탭 이동은 iOS·안드로이드
 * 모두 스토어 앱으로 넘어간다.
 */
export function StoreBadges({
  surface,
  size = "md",
  className = "",
}: {
  surface: StoreLinkSurface;
  size?: StoreBadgeSize;
  className?: string;
}) {
  const height = BADGE_HEIGHT[size];

  return (
    <div className={`flex flex-wrap items-center gap-3 ${className}`}>
      {STORE_ORDER.map((store) => {
        const art = BADGE_ART[store];

        return (
          <a
            key={store}
            href={goHref(store, surface)}
            className="inline-flex rounded-[10px] transition hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#3182f6]"
          >
            <Image
              src={art.src}
              alt={art.alt}
              width={Math.round(height * art.aspect)}
              height={height}
              priority={size === "lg"}
            />
          </a>
        );
      })}
    </div>
  );
}
