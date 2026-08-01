"use client";

// 신고와 차단. 글에도 댓글에도 붙는다.
//
// 앱스토어가 사용자 제작 글이 오가는 앱에 요구하는 최소 장치이기도 하지만, 그보다
// 먼저 여기서 글을 쓰는 사람이 도망갈 구석을 갖는 문제다.

import { useState } from "react";

import {
  blockUser,
  REPORT_REASONS,
  reportContent,
  type ReportReason,
  type ReportTargetType,
} from "@/lib/api/v2/community";
import { errorMessage, PrimaryButton, QuietButton } from "./shell";

export type ModerationTarget = {
  type: ReportTargetType;
  id: string;
  authorId: string;
  authorName: string;
};

export function ModerationDialog({
  target,
  onClose,
  onBlocked,
}: {
  target: ModerationTarget;
  onClose: () => void;
  onBlocked: () => void;
}) {
  const [reason, setReason] = useState<ReportReason>("spam");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submitReport() {
    setBusy(true);
    setMessage(null);
    try {
      await reportContent({
        targetType: target.type,
        targetId: target.id,
        reason,
        detail: detail.trim() || null,
      });
      setDone(true);
    } catch (cause) {
      setMessage(errorMessage(cause, "신고를 접수하지 못했어요."));
    } finally {
      setBusy(false);
    }
  }

  async function block() {
    setBusy(true);
    setMessage(null);
    try {
      await blockUser(target.authorId);
      onBlocked();
    } catch (cause) {
      setMessage(errorMessage(cause, "차단하지 못했어요."));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-4 pb-4 sm:items-center sm:pb-0">
      <div className="w-full max-w-[420px] rounded-3xl bg-white p-6">
        {done ? (
          <>
            <h2 className="text-lg font-black text-[#191f28]">신고를 접수했어요</h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-[#4e5968]">
              확인하는 데 시간이 걸릴 수 있어요. 이 사람 글을 더 보고 싶지 않다면
              차단할 수도 있어요.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <QuietButton onClick={onClose}>닫기</QuietButton>
              <PrimaryButton onClick={block} disabled={busy}>
                {target.authorName} 차단하기
              </PrimaryButton>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-lg font-black text-[#191f28]">
              무엇이 문제인가요?
            </h2>
            <div className="mt-4 space-y-1">
              {REPORT_REASONS.map((item) => (
                <label
                  key={item.value}
                  className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-sm font-bold text-[#4e5968] hover:bg-[#f2f4f6]"
                >
                  <input
                    type="radio"
                    name="report-reason"
                    value={item.value}
                    checked={reason === item.value}
                    onChange={() => setReason(item.value)}
                  />
                  {item.label}
                </label>
              ))}
            </div>
            <textarea
              value={detail}
              onChange={(event) => setDetail(event.target.value)}
              maxLength={500}
              rows={3}
              placeholder="덧붙일 말이 있다면 적어주세요 (선택)"
              className="mt-3 w-full resize-none rounded-2xl bg-[#f2f4f6] px-4 py-3 text-sm font-semibold text-[#191f28] outline-none placeholder:text-[#8b95a1]"
            />
            {message && (
              <p className="mt-3 text-[13px] font-bold text-[#e5484d]">{message}</p>
            )}
            <div className="mt-5 flex items-center justify-between">
              <QuietButton onClick={block} disabled={busy}>
                신고 없이 차단만
              </QuietButton>
              <div className="flex gap-2">
                <QuietButton onClick={onClose} disabled={busy}>
                  취소
                </QuietButton>
                <PrimaryButton onClick={submitReport} disabled={busy}>
                  신고하기
                </PrimaryButton>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** 글·댓글 오른쪽의 ⋯ 자리. 내 것이면 수정·삭제, 남의 것이면 신고·차단. */
export function ItemMenu({
  mine,
  onEdit,
  onDelete,
  onReport,
}: {
  mine: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  onReport?: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center">
      {mine ? (
        <>
          {onEdit && <QuietButton onClick={onEdit}>수정</QuietButton>}
          {onDelete && <QuietButton onClick={onDelete}>삭제</QuietButton>}
        </>
      ) : (
        onReport && <QuietButton onClick={onReport}>신고</QuietButton>
      )}
    </div>
  );
}
