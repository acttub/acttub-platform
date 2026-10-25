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

type Phase = "idle" | "sending" | "done" | "invalid" | "limited" | "failed";

/** 로그인 없이도 보낼 수 있는 문의 양식. 서버에 닿지 않으면 메일 주소를 대신 보여 준다. */
export function ContactForm() {
  const [type, setType] = useState<InquiryType>(INQUIRY_TYPES[0]);
  const [email, setEmail] = useState("");
  const [body, setBody] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
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

  const mailto = `mailto:${BUSINESS_INFO.email}?subject=${encodeURIComponent(`[Acttub] ${type}`)}&body=${encodeURIComponent(`회신 이메일: ${email}\n\n${body.trim()}`)}`;
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
          지금은 보내지 못했어요. <a href={mailto} className="font-semibold text-[#3182f6] underline underline-offset-2">{BUSINESS_INFO.email}</a> 주소로 메일을 보내 주세요.
        </p>
      ) : null}
    </form>
  );
}
