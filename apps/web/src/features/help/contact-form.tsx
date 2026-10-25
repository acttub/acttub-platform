"use client";

import { useState } from "react";
import { BUSINESS_INFO } from "@/features/business-info/business-info";
import { INQUIRY_TYPES } from "@/features/help/help-content";

/**
 * 1차는 서버 접수 없이 메일 앱으로 넘긴다. 받는 곳은 앱의 「문의·신고 메일」과 같은 주소다.
 * 서버 접수(POST /v2/support/inquiries)가 생기면 이 제출만 바꾼다(SOMA-834 남은 일).
 */
export function ContactForm() {
  const [type, setType] = useState<string>(INQUIRY_TYPES[0]);
  const [email, setEmail] = useState("");
  const [body, setBody] = useState("");
  const [opened, setOpened] = useState(false);
  const ready = email.includes("@") && body.trim().length > 0;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ready) return;
    const subject = `[Acttub] ${type}`;
    const text = `회신 이메일: ${email}\n\n${body.trim()}`;
    window.location.href = `mailto:${BUSINESS_INFO.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
    setOpened(true);
  }

  const field = "mt-2 w-full rounded-2xl bg-white px-4 py-3 text-base ring-1 ring-[#e5e8eb] focus:outline-none focus:ring-2 focus:ring-[#3182f6]";
  return (
    <form onSubmit={submit} className="mt-8 space-y-5">
      <label className="block text-sm font-bold">
        유형
        <select value={type} onChange={(e) => setType(e.target.value)} className={field}>
          {INQUIRY_TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
      </label>
      <label className="block text-sm font-bold">
        회신 이메일
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="answer@example.com" className={field} />
      </label>
      <label className="block text-sm font-bold">
        내용
        <textarea required rows={7} value={body} onChange={(e) => setBody(e.target.value)} placeholder="어떤 화면에서 무엇을 하다가 생긴 일인지 적어 주세요" className={field} />
      </label>
      <button type="submit" disabled={!ready} className="w-full rounded-2xl bg-[#3182f6] py-3.5 font-bold text-white disabled:bg-[#d1d6db]">
        메일로 보내기
      </button>
      {opened ? (
        <p role="status" className="text-sm leading-6 text-[#4e5968]">
          메일 앱이 열렸어요. 열리지 않으면 {BUSINESS_INFO.email}로 보내 주세요.
        </p>
      ) : null}
    </form>
  );
}
