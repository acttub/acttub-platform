// 내 계정 「내 문의」 목록(SOMA-834). 서버의 문의 상태는 open·closed 둘이다(app.support-inquiry).
import type { MyInquiry } from "@/lib/api/v2/support";

import { inquiryStatusLabel, shortDate } from "./account-format";

export function InquiryList({ items }: { items: MyInquiry[] }) {
  if (items.length === 0) {
    return <p className="mt-4 text-[15px] leading-7 text-[#8b95a1]">아직 보낸 문의가 없어요.</p>;
  }
  return (
    <ul className="mt-3 divide-y divide-[#f2f4f6]">
      {items.map((item) => (
        <li key={item.id} className="flex items-center gap-3 py-4">
          <span className="shrink-0 rounded-lg bg-[#f2f4f6] px-2.5 py-1 text-[13px] font-bold text-[#4e5968]">{inquiryStatusLabel(item.status)}</span>
          <span className="min-w-0 flex-1 truncate text-[15px]">{item.summary}</span>
          <span className="shrink-0 text-sm text-[#8b95a1]">{shortDate(item.created_at)}</span>
        </li>
      ))}
    </ul>
  );
}
