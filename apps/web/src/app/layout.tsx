import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { Analytics } from "@/features/analytics/analytics";
import { ConsentEntryBoundary } from "@/features/auth/consent-entry-boundary";
import { ConsentRedirectListener } from "@/features/auth/consent-redirect-listener";
import { buildRootMetadata } from "@/lib/seo/site-metadata";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = buildRootMetadata();

// 인스타 인앱 웹뷰(안드로이드)를 기본 브라우저로 내보낸다.
// iOS는 WKWebView가 커스텀 스킴을 막아 해당 없음 — 로그인 화면의 안내 문구가 남는다.
const INAPP_ESCAPE = `
(function () {
  var ua = navigator.userAgent || "";
  if (!/Instagram|FBAN|FBAV|FB_IAB|Threads/i.test(ua)) return;
  if (!/Android/i.test(ua)) return;
  try {
    if (new URLSearchParams(location.search).get("ib") === "1") return;
  } catch (e) {
    if (/[?&]ib=1(&|$)/.test(location.search)) return;
  }
  if (navigator.webdriver) return;
  location.replace(
    "intent://" + location.href.split("#")[0].replace(/^https?:\\/\\//, "") +
    "#Intent;scheme=https;end"
  );
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: INAPP_ESCAPE }} />
      </head>
      <body className="min-h-full flex flex-col">
        {/* 계측이 지켜야 하는 조건(동의 전 쿠키 금지·주소에서 식별자 제거·실서비스 호스트
            한정)은 전부 lib/analytics/ga.ts 주석에 있다. 여기서는 자리만 잡는다. */}
        <Analytics />
        <ConsentRedirectListener />
        <ConsentEntryBoundary>{children}</ConsentEntryBoundary>
      </body>
    </html>
  );
}
