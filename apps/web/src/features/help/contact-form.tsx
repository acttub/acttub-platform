"use client";

import { useState } from "react";
import { BUSINESS_INFO } from "@/features/business-info/business-info";
import {
  INQUIRY_BODY_MAX,
  INQUIRY_BODY_MIN,
  INQUIRY_CATEGORY,
  INQUIRY_TYPES,
  type InquiryType,
} from "@/features/help/help-content";
import { submitInquiry } from "@/lib/api/v2/support";
import { ApiError } from "@/lib/api/v2/errors";

type Phase = "idle" | "sending" | "done" | "invalid" | "limited" | "mail" | "failed";

// 메일 앱 주소가 너무 길면 일부 앱이 열지 못한다. 본문은 이만큼만 싣고, 전체는 복사해 붙이게 한다.
const MAILTO_BODY_MAX = 1500;

/** 로그인 없이도 보낼 수 있는 문의 양식. 서버에 닿지 않으면 메일 주소를 대신 보여 준다. */
export function ContactForm() {
  const [type, setType] = useState<InquiryType>(INQUIRY_TYPES[0]);
  const [email, setEmail] = useState("");
  const [body, setBody] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [copied, setCopied] = useState(false);
  const length = body.trim().length;
  const ready = email.includes("@") && length >= INQUIRY_BODY_MIN && length <= INQUIRY_BODY_MAX;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ready || phase === "sending") return;
    setPhase("sending");
    try {
      await submitInquiry({ category: INQUIRY_CATEGORY[type], email: email.trim(), body: body.trim() });
      setPhase("done");
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) setPhase("invalid");
      else if (error instanceof ApiError && error.status === 429) setPhase("limited");
      // 서버에 문의 접수가 아직 없다(404·405, 토큰 없는 요청은 401). 메일로 받는다.
      else if (error instanceof ApiError && [401, 404, 405].includes(error.status)) setPhase("mail");
      else setPhase("failed");
    }
  }

  if (phase === "done") {
    return (
      <div role="status" className="mt-8 rounded-2xl bg-white p-6 ring-1 ring-[#e5e8eb]">
        <p className="text-lg font-bold">문의를 받았어요</p>
        <p className="mt-2 text-base leading-7 text-[#4e5968]">
          {email.trim()} 주소로 답장을 보내 드릴게요.
        </p>
      </div>
    );
  }

  const fullText = `회신 이메일: ${email.trim()}\n\n${body.trim()}`;
  const mailBody = fullText.length > MAILTO_BODY_MAX ? `${fullText.slice(0, MAILTO_BODY_MAX)}\n…(이어지는 내용은 붙여 넣어 주세요)` : fullText;
  const mailto = `mailto:${BUSINESS_INFO.email}?subject=${encodeURIComponent(`[Acttub] ${type}`)}&body=${encodeURIComponent(mailBody)}`;

  async function copyText() {
    try {
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (phase === "mail") {
    return (
      <div role="status" className="mt-8 space-y-3 rounded-2xl bg-white p-6 ring-1 ring-[#e5e8eb]">
        <p className="text-lg font-bold">메일로 보내 주세요</p>
        <p className="text-base leading-7 text-[#4e5968]">
          지금은 이 화면에서 바로 접수하지 않고 메일로 받고 있어요. 「메일 쓰기」를 누르면 적어 주신 내용이 담긴 메일이 열려요.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <a href={mailto} className="rounded-2xl bg-[#3182f6] px-5 py-3 font-bold text-white">메일 쓰기</a>
          <button type="button" onClick={() => void copyText()} className="rounded-2xl px-5 py-3 font-bold text-[#4e5968] ring-1 ring-[#e5e8eb]">
            {copied ? "복사했어요" : "내용 복사"}
          </button>
        </div>
        <p className="text-sm text-[#6b7684]">받는 주소: {BUSINESS_INFO.email}</p>
      </div>
    );
  }
  const field = "mt-2 w-full rounded-2xl bg-white px-4 py-3 text-base ring-1 ring-[#e5e8eb] focus:outline-none focus:ring-2 focus:ring-[#3182f6]";
  return (
    <form onSubmit={submit} className="mt-8 space-y-5">
      <label className="block text-sm font-bold">
        유형
        <select value={type} onChange={(e) => setType(e.target.value as InquiryType)} className={field}>
          {INQUIRY_TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
      </label>
      <label className="block text-sm font-bold">
        회신 이메일
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="answer@example.com" className={field} />
      </label>
      <label className="block text-sm font-bold">
        내용
        <textarea
          required
          rows={7}
          maxLength={INQUIRY_BODY_MAX}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="어떤 화면에서 무엇을 하다가 생긴 일인지 적어 주세요"
          className={field}
        />
        <span className="mt-1 block text-right text-xs font-normal text-[#8b95a1]">
          {length < INQUIRY_BODY_MIN ? `${INQUIRY_BODY_MIN}자 이상 적어 주세요` : `${length}/${INQUIRY_BODY_MAX}`}
        </span>
      </label>
      <button type="submit" disabled={!ready || phase === "sending"} className="w-full rounded-2xl bg-[#3182f6] py-3.5 font-bold text-white disabled:bg-[#d1d6db]">
        {phase === "sending" ? "보내는 중이에요" : "문의 보내기"}
      </button>
      {phase === "invalid" ? (
        <p role="alert" className="text-sm leading-6 text-[#f04452]">이메일 주소와 내용을 다시 확인해 주세요.</p>
      ) : null}
      {phase === "limited" ? (
        <p role="alert" className="text-sm leading-6 text-[#f04452]">문의가 많이 몰렸어요. 잠시 뒤 다시 보내 주세요.</p>
      ) : null}
      {phase === "failed" ? (
        <p role="alert" className="text-sm leading-6 text-[#4e5968]">
          지금은 보내지 못했어요. 잠시 뒤 다시 보내거나 <a href={mailto} className="font-semibold text-[#3182f6] underline underline-offset-2">{BUSINESS_INFO.email}</a> 주소로 메일을 보내 주세요.
        </p>
      ) : null}
    </form>
  );
}
