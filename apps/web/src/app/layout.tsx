import type { Metadata } from "next";
import { Geist } from "next/font/google";
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
        <ConsentRedirectListener />
        {children}
      </body>
    </html>
  );
}
