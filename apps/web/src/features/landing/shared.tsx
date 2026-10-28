import Image from "next/image";

/**
 * 랜딩 색(SOMA-918 2차). 따뜻한 먹색과 미색 두 바탕만 쓴다.
 * 브랜드 주황은 주된 버튼과 아주 작은 표시에만 쓴다.
 */
export const INK = "#14110e";
export const PAPER = "#f3ede3";
export const ORANGE = "#ffa21f";

/** 제목 글꼴. --font-serif-kr 은 landing-client 가 바깥 div 에 건다. */
export const SERIF = "landing-serif";

export const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#1c1814]";
export const FOCUS_ON_DARK =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#f2ebe0]";

/** 먹색 위 주된 버튼. 주황은 여기에만 크게 쓴다. */
export const PRIMARY_BUTTON = `inline-flex h-[52px] items-center justify-center rounded-[10px] bg-[#ffa21f] px-6 text-[16px] font-semibold text-[#1a140d] transition-colors hover:bg-[#ffb44a] ${FOCUS_ON_DARK}`;
/** 먹색 위 보조 버튼. 얇은 테두리만 있다. */
export const GHOST_BUTTON_DARK = `inline-flex h-[52px] items-center justify-center rounded-[10px] border border-[#f2ebe0]/25 px-6 text-[16px] font-medium text-[#f2ebe0] transition-colors hover:border-[#f2ebe0]/60 ${FOCUS_ON_DARK}`;
/** 미색 위 보조 버튼. */
export const GHOST_BUTTON_LIGHT = `inline-flex h-[52px] items-center justify-center rounded-[10px] border border-[#1c1814]/25 px-6 text-[16px] font-medium text-[#1c1814] transition-colors hover:border-[#1c1814]/60 ${FOCUS}`;

/** 아주 옅은 필름 그레인. 움직이지 않는 SVG 잡음 한 장을 덮는다. */
export function Grain({ opacity = 0.07 }: { opacity?: number }) {
  return (
    <div
      aria-hidden="true"
      className="landing-grain pointer-events-none absolute inset-0"
      style={{ opacity }}
    />
  );
}

/**
 * 실제 앱 화면. 조명을 받는 물건처럼 얇은 검은 테두리와 아래로 떨어지는 그림자만 준다.
 * 원본 캡처가 600px 폭이라 화면에서 300px(레티나 2배) 넘게 키우지 않는다.
 */
export function Phone({
  src,
  alt,
  className = "",
  priority = false,
  onPaper = false,
}: {
  src: string;
  alt: string;
  className?: string;
  priority?: boolean;
  onPaper?: boolean;
}) {
  return (
    <div
      className={`rounded-[38px] bg-[#0d0b09] p-[7px] ring-1 ${
        onPaper
          ? "ring-[#1c1814]/10 shadow-[0_28px_50px_-18px_rgba(46,32,16,0.45),0_8px_16px_-8px_rgba(46,32,16,0.25)]"
          : "ring-white/10 shadow-[0_40px_70px_-20px_rgba(0,0,0,0.75),0_10px_20px_-10px_rgba(0,0,0,0.6)]"
      } ${className}`}
    >
      <Image
        src={src}
        alt={alt}
        width={300}
        height={649}
        sizes="300px"
        priority={priority}
        className="block h-auto w-full rounded-[31px] bg-white"
      />
    </div>
  );
}

/** 설치 QR. 어두운 화면에서도 카메라가 읽도록 작은 미색 바탕만 깐다. */
export function Qr({ size }: { size: number }) {
  return (
    <Image
      src="/site/app-qr.svg"
      alt="앱 설치 QR 코드"
      width={size}
      height={size}
      unoptimized
      className="rounded-[8px] bg-[#f3ede3] p-[7px]"
    />
  );
}

const ACTY = {
  "stage-bow": { w: 321, h: 292 },
  whisper: { w: 243, h: 240 },
  slate: { w: 284, h: 259 },
  curtain: { w: 258, h: 289 },
} as const;

export type ActyPose = keyof typeof ACTY;

/**
 * 액티. 원본이 300px 안팎이라 화면 폭은 150px 이하로만 쓴다. 구간마다 많아야 하나, 장면 속 조연처럼 작게 둔다.
 */
export function Acty({
  pose,
  width,
  alt = "",
  className = "",
  priority = false,
}: {
  pose: ActyPose;
  width: number;
  alt?: string;
  className?: string;
  priority?: boolean;
}) {
  const art = ACTY[pose];
  const w = Math.min(width, 150);
  return (
    <Image
      src={`/site/acty/${pose}.png`}
      alt={alt}
      width={w}
      height={Math.round((w * art.h) / art.w)}
      sizes={`${w}px`}
      priority={priority}
      className={`h-auto select-none ${className}`}
      draggable={false}
    />
  );
}
