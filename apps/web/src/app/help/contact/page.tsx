import Link from "next/link";
import { ContactForm } from "@/features/help/contact-form";
import { buildNoindexMetadata } from "@/lib/seo/site-metadata";

export const metadata = buildNoindexMetadata("문의하기");

export default function ContactPage() {
  return (
    <div className="min-h-dvh break-keep bg-[#f2f4f6] text-[#191f28]">
      <main className="mx-auto max-w-xl px-5 py-10 sm:px-8">
        <Link href="/help" className="text-sm font-semibold text-[#4e5968]">← 고객센터</Link>
        <h1 className="mt-4 text-3xl font-black tracking-[-0.03em]">문의하기</h1>
        <p className="mt-2 text-sm leading-6 text-[#4e5968]">로그인하지 않아도 보낼 수 있어요. 답은 적어 주신 이메일로 드려요.</p>
        <ContactForm />
      </main>
    </div>
  );
}
