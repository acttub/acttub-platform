// app.audition — 오디션 공고 모아보기의 본문. 껍데기(상단 바·조회·저장소)는 auditions-page 가 들고,
// 여기는 받은 값만 그린다. next/link 를 끌어오지 않아 Node 테스트에서 그대로 그릴 수 있다.
//
// 공고 제목·출연료 문구는 외부 원문이라 React 텍스트로만 넣는다(HTML로 풀지 않는다).

import type { AuditionPosting } from "@/lib/api/v2/auditions";

import {
  AUDITION_GROUPS,
  BUCKET_LABEL,
  CATEGORY_LABEL,
  auditionSections,
  collectedAgo,
  ddayLabel,
  filterAuditions,
  groupCounts,
  isNewPosting,
  shortDate,
  EMPTY_AUDITION_FILTERS,
  type AuditionFilters,
  type DdayTone,
} from "./audition-list";

export type AuditionsBodyProps = {
  status: "loading" | "failed" | "ready";
  items: AuditionPosting[];
  collectedAt: string | null;
  /** 응답을 받은 순간의 KST 날짜. 받기 전에는 null. */
  today: string | null;
  /** 「몇 시간 전 수집」을 재는 기준 시각(ms). */
  now: number;
  errorMessage: string | null;
  filters: AuditionFilters;
  starred: ReadonlySet<string>;
  seen: ReadonlySet<string>;
  onFilters: (update: (was: AuditionFilters) => AuditionFilters) => void;
  onToggleStar: (id: string) => void;
  onOpen: (id: string) => void;
  onRetry: () => void;
};

export function AuditionsBody(props: AuditionsBodyProps) {
  const { status, items, collectedAt, today, now, errorMessage, filters, onFilters } = props;

  const visible = today ? filterAuditions(items, filters, today, props.starred) : [];
  const sections = today ? auditionSections(visible, today) : [];
  const chips = groupCounts(items);
  const ago = collectedAgo(collectedAt, now);
  const filtered =
    filters.query.trim() !== "" ||
    filters.group !== "all" ||
    filters.week ||
    filters.paid ||
    filters.starred;
  const sources = [...new Set(items.map(({ source_name }) => source_name))];

  return (
    <div className="mx-auto w-full max-w-[760px] px-4 py-8 sm:px-5 sm:py-10">
      <h1 className="text-[26px] font-black tracking-[-0.03em] text-[#191f28]">오디션 공고</h1>
      <p className="mt-2 text-sm font-semibold leading-6 text-[#4e5968]">
        여러 곳에 흩어진 배우 오디션 공고를 하루 두 번 모아, 마감이 가까운 순으로 보여 줘요.
      </p>

      <p className="mt-4 rounded-2xl bg-[#fff4e6] px-4 py-3 text-[13px] font-bold leading-5 text-[#b45309]">
        ⓘ 공고 내용과 지원은 반드시 원문에서 확인하세요. 카드를 누르면 원문이 새 탭으로 열려요.
      </p>

      {status === "loading" && <Status>공고를 불러오고 있어요.</Status>}

      {status === "failed" && (
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <p className="text-sm font-semibold text-[#e5484d]">{errorMessage}</p>
          <button
            type="button"
            onClick={props.onRetry}
            className="rounded-xl border border-[#e5e8eb] bg-white px-4 py-2 text-[13px] font-black text-[#4e5968]"
          >
            다시 시도
          </button>
        </div>
      )}

      {status === "ready" && items.length === 0 && (
        <Status>
          지금 지원할 수 있는 공고가 없어요.
          <br />
          하루 두 번 새로 모아요.
        </Status>
      )}

      {status === "ready" && items.length > 0 && (
        <>
          <p className="mt-6 text-[12px] font-bold text-[#8b95a1]">
            지원 가능 {items.length}건{ago ? ` · ${ago} 수집` : ""}
          </p>

          <input
            type="search"
            value={filters.query}
            onChange={(event) => {
              const query = event.target.value;
              onFilters((was) => ({ ...was, query }));
            }}
            placeholder="제목·출연료·출처 검색"
            aria-label="공고 검색"
            className="mt-2 w-full rounded-xl border border-[#e5e8eb] bg-white px-4 py-2.5 text-[14px] font-semibold text-[#191f28] outline-none placeholder:text-[#b0b8c1] focus:border-[#3182f6]"
          />

          <div className="mt-3 flex flex-wrap gap-1.5" aria-label="분야">
            {chips.map(({ key, count }) => (
              <Chip
                key={key}
                on={filters.group === key}
                onClick={() => onFilters((was) => ({ ...was, group: key }))}
              >
                {AUDITION_GROUPS.find((group) => group.key === key)?.label}{" "}
                <span className="opacity-70">{count}</span>
              </Chip>
            ))}
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5">
            <Toggle
              on={filters.week}
              onClick={() => onFilters((was) => ({ ...was, week: !was.week }))}
            >
              7일 안에 마감
            </Toggle>
            <Toggle
              on={filters.paid}
              onClick={() => onFilters((was) => ({ ...was, paid: !was.paid }))}
            >
              출연료 명시
            </Toggle>
            <Toggle
              on={filters.starred}
              onClick={() => onFilters((was) => ({ ...was, starred: !was.starred }))}
            >
              ★ 찜한 공고
            </Toggle>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <p className="text-[12px] font-bold text-[#8b95a1]">{visible.length}건</p>
            {filtered && (
              <button
                type="button"
                onClick={() => onFilters(() => EMPTY_AUDITION_FILTERS)}
                className="text-[12px] font-black text-[#3182f6] hover:underline"
              >
                필터 초기화
              </button>
            )}
          </div>

          {sections.map(({ bucket, data }) => (
            <section key={bucket} className="mt-4">
              <h2 className="text-[13px] font-black text-[#4e5968]">
                {BUCKET_LABEL[bucket]} · {data.length}
              </h2>
              <div className="mt-2 space-y-2">
                {data.map((posting) => (
                  <PostingCard
                    key={posting.id}
                    posting={posting}
                    today={today as string}
                    starred={props.starred.has(posting.id)}
                    seen={props.seen.has(posting.id)}
                    onToggleStar={() => props.onToggleStar(posting.id)}
                    onOpen={() => props.onOpen(posting.id)}
                  />
                ))}
              </div>
            </section>
          ))}

          {visible.length === 0 && (
            <Status>
              {filters.starred ? (
                <>
                  찜한 공고가 없어요.
                  <br />
                  카드 오른쪽 별을 눌러 모아 두세요.
                </>
              ) : (
                "조건에 맞는 공고가 없어요."
              )}
            </Status>
          )}
        </>
      )}

      <p className="mt-10 text-[12px] font-semibold leading-5 text-[#8b95a1]">
        이 화면은 공고 목록의 사실 정보(제목·분야·출연료 문구·접수 기간)만 보여 줘요. 공고 내용과
        지원은 원문 기준이에요.
        {sources.length > 0 && (
          <>
            <br />
            출처: {sources.join(" · ")}
          </>
        )}
      </p>
    </div>
  );
}

const DDAY_TONE: Record<DdayTone, string> = {
  urgent: "bg-[#fff0f0] text-[#e5484d]",
  soon: "bg-[#fff4e6] text-[#b45309]",
  calm: "bg-[#e8f3ff] text-[#3182f6]",
  none: "bg-[#f2f4f6] text-[#8b95a1]",
};

/**
 * 공고 카드. 카드 전체가 원문 링크이고, 별(찜)만 링크 밖의 버튼이다 — 링크 안에 버튼을 넣으면
 * 별을 눌러도 원문이 열린다.
 */
function PostingCard({
  posting,
  today,
  starred,
  seen,
  onToggleStar,
  onOpen,
}: {
  posting: AuditionPosting;
  today: string;
  starred: boolean;
  seen: boolean;
  onToggleStar: () => void;
  onOpen: () => void;
}) {
  const dday = ddayLabel(posting, today);
  const posted = shortDate(posting.posted_on);
  return (
    <article className="flex items-stretch rounded-2xl border border-[#e5e8eb] bg-white hover:border-[#3182f6]">
      <a
        href={posting.source_url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onOpen}
        aria-label={`${posting.title} 원문 열기`}
        className="flex min-w-0 flex-1 items-start gap-3 py-3 pl-3 sm:pl-4"
      >
        <div
          className={`flex w-[64px] shrink-0 flex-col items-center justify-center rounded-xl px-1 py-2 text-center ${DDAY_TONE[dday.tone]}`}
        >
          <span className="text-[15px] font-black leading-tight">{dday.main}</span>
          <span className="mt-0.5 text-[10px] font-bold leading-tight opacity-80">{dday.sub}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1">
            {isNewPosting(posting, today) && (
              <span className="rounded-full bg-[#3182f6] px-2 py-0.5 text-[10px] font-black text-white">
                NEW
              </span>
            )}
            <span className="rounded-full bg-[#f2f4f6] px-2 py-0.5 text-[11px] font-black text-[#4e5968]">
              {CATEGORY_LABEL[posting.category] ?? "기타"}
            </span>
            <span className="text-[11px] font-bold text-[#8b95a1]">{posting.source_name}</span>
            {seen && <span className="text-[11px] font-bold text-[#b0b8c1]">· 봤음</span>}
          </div>
          <p
            className={`mt-1 line-clamp-2 break-words text-[15px] font-black leading-snug ${
              seen ? "text-[#8b95a1]" : "text-[#191f28]"
            }`}
          >
            {posting.title}
          </p>
          <p className="mt-1 break-words text-[12px] font-semibold text-[#8b95a1]">
            {[posting.pay_text ? `출연료 ${posting.pay_text}` : "", posted ? `${posted} 등록` : ""]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </a>
      <button
        type="button"
        onClick={onToggleStar}
        aria-pressed={starred}
        aria-label={starred ? "찜 해제" : "찜하기"}
        className={`shrink-0 px-3 text-[20px] leading-none sm:px-4 ${
          starred ? "text-[#f59e0b]" : "text-[#d1d6db] hover:text-[#8b95a1]"
        }`}
      >
        {starred ? "★" : "☆"}
      </button>
    </article>
  );
}

function Status({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-8 py-6 text-center text-sm font-semibold leading-6 text-[#8b95a1]">
      {children}
    </p>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-full px-3 py-1.5 text-[12px] font-black ${
        on ? "bg-[#191f28] text-white" : "bg-white text-[#4e5968] ring-1 ring-[#e5e8eb]"
      }`}
    >
      {children}
    </button>
  );
}

function Toggle({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-full px-3 py-1.5 text-[12px] font-black ${
        on ? "bg-[#3182f6] text-white" : "bg-[#f2f4f6] text-[#4e5968]"
      }`}
    >
      {children}
    </button>
  );
}
