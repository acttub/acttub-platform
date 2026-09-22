"use client";

import { useState } from "react";
import { getConversation } from "@/lib/api/v2/coach-conversations";
import type { Practice } from "@/lib/practice/api-types";
import { useResource } from "@/lib/react/use-resource";
import { conversationLines } from "./conversation-view";

/** 이관한 과거 자료의 대화들. 새 대화를 만들거나 답장을 보내지 않는다. */
export function PreviousConversations({ conversations }: { conversations: Practice["previous_conversations"] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const visibleId = conversations.some((item) => item.id === selected) ? selected : null;
  const conversation = useResource(visibleId, (id, signal) => getConversation(id, { signal }), "대화를 불러오지 못했어요.");
  if (conversations.length === 0) return null;
  return (
    <section className="mt-4 border-t border-[#e5e8eb] pt-4">
      <h3 className="text-sm font-bold text-[#4e5968]">이전 대화</h3>
      {conversations.map((item, index) => (
        <div key={item.id} className="mt-2">
          <button type="button" aria-expanded={visibleId === item.id}
            className="min-h-11 text-sm font-semibold text-[#3182f6]"
            onClick={() => setSelected((id) => id === item.id ? null : item.id)}>
            이전 대화 {index + 1} {visibleId === item.id ? "접기" : "보기"}
          </button>
          {visibleId === item.id ? (
            conversation.state === "failed" ? <p role="alert">{conversation.message}</p>
              : conversation.state === "ready" ? <ol className="grid gap-3 py-2">
                {conversationLines(conversation.data).map((line, i) => <li key={i}>
                  <p className="text-xs text-[#8b95a1]">{line.role === "me" ? "나" : "코치"}</p>
                  <p className="whitespace-pre-wrap break-words text-sm leading-6 text-[#333d4b]">{line.text}</p>
                </li>)}
              </ol> : <p role="status">대화를 불러오고 있어요.</p>
          ) : null}
        </div>
      ))}
    </section>
  );
}
