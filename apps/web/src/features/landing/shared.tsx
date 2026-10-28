import Image from "next/image";

/** 랜딩 전용 색. 앱 마스코트(액티)의 주황과 눈동자 남색에서 가져왔다. */
export const INK = "#151a30";
export const ORANGE = "#ffa21f";
export const CREAM = "#fff6e6";

export const FOCUS =
  "focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#4880ee]";
export const FOCUS_ON_DARK =
  "focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-white";

export function Phone({
  src,
  alt,
  className = "",
  priority = false,
}: {
  src: string;
  alt: string;
  className?: string;
  priority?: boolean;
}) {
  return (
    <div className={`rounded-[44px] bg-[#0d1020] p-2.5 shadow-[0_30px_60px_rgba(8,10,25,0.35)] ${className}`}>
      <Image
        src={src}
        alt={alt}
        width={390}
        height={844}
        priority={priority}
        className="block h-auto w-full rounded-[34px] bg-white"
      />
    </div>
  );
}

export function Qr({ size }: { size: number }) {
  return (
    <Image
      src="/site/app-qr.svg"
      alt="앱 설치 QR 코드"
      width={size}
      height={size}
      unoptimized
      className="rounded-xl border border-[#e5e8eb] bg-white p-2"
    />
  );
}

export function Acty({
  name,
  alt = "",
  size,
  className = "",
  priority = false,
}: {
  name: "home" | "cheer" | "coach" | "reading";
  alt?: string;
  size: number;
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src={`/site/acty/${name}.png`}
      alt={alt}
      width={size}
      height={size}
      priority={priority}
      className={`h-auto ${className}`}
    />
  );
}
