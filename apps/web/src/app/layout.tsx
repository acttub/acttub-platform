import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { Analytics } from "@/features/analytics/analytics";
import { ConsentRedirectListener } from "@/features/auth/consent-redirect-listener";
import { buildRootMetadata } from "@/lib/seo/site-metadata";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = buildRootMetadata();

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
      <body className="min-h-full flex flex-col">
        {/* 계측이 지켜야 하는 조건(동의 전 쿠키 금지·주소에서 식별자 제거·실서비스 호스트
            한정)은 전부 lib/analytics/ga.ts 주석에 있다. 여기서는 자리만 잡는다. */}
        <Analytics />
        <ConsentRedirectListener />
        {children}
      </body>
    </html>
  );
}
