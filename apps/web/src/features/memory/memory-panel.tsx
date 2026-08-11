"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useRequireAuth } from "../auth/use-require-auth";
import {
  deleteAllMemory,
  deleteMemoryField,
  getMemory,
  saveMemoryField,
  MEMORY_VALUE_MAX_LENGTH,
  type MemoryField,
  type MemoryItem,
} from "../../lib/api/v2/memory";

/**
 * 코치가 나에 대해 기억하는 것 — 배우가 보고 고치는 화면.
 *
 * 코치는 연습이 끝날 때마다 대화에서 알아낸 것을 여기에 쌓고, 다음 연습을 시작할
 * 때 이걸 읽는다. 그래서 **틀린 내용을 되돌릴 수 있는 유일한 자리**가 이 화면이다.
 * 없으면 잘못 적힌 내용이 이후 모든 대화의 전제로 굳는다.
 *
 * 칸마다 두 가지를 반드시 보여준다.
 * - **어느 연습에서 나온 말인지** — 근거를 봐야 고칠지 판단이 선다.
 * - **누가 적었는지** — 내가 고친 칸은 코치가 다시 덮지 않는다는 걸 알아야
 *   고치는 의미가 생긴다.
 */

const FIELDS: {
  field: MemoryField;
  label: string;
  hint: string;
  placeholder: string;
}[] = [
  {
    field: "goal",
    label: "목표",
    hint: "연습으로 이루고 싶은 것",
    placeholder: "예) 입시에서 자유연기로 붙기",
  },
  {
    field: "blockage",
    label: "자주 막히는 지점",
    hint: "연습마다 고른 것들이 쌓인 결과",
    placeholder: "예) 대사의 의도를 잡는 게 늘 어렵다",
  },
  {
    field: "speech_self",
    label: "내가 생각하는 내 화법",
    hint: "대화에서 스스로 말한 것",
    placeholder: "예) 차분하게 말하려고 한다",
  },
  {
    field: "speech_actual",
    label: "실제로 말한 방식",
    hint: "영상에서 받아쓴 대사를 근거로 적힌 것",
    placeholder: "예) 문장 끝을 흐리며 빨라진다",
  },
];

export function MemoryPanel() {
  const { ready } = useRequireAuth();
  const [items, setItems] = useState<Record<string, MemoryItem>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [savedField, setSavedField] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await getMemory({ signal: controller.signal });
        const next: Record<string, MemoryItem> = {};
        for (const item of res.items) next[item.field] = item;
        setItems(next);
        setDrafts(
          Object.fromEntries(res.items.map((i) => [i.field, i.value])),
        );
      } catch {
        // 못 불러왔을 때 빈 화면과 구분돼야 한다. 빈 상태로 보이면 배우가
        // "코치가 아무것도 모르는구나" 로 잘못 읽는다.
        setError("지금은 불러오지 못했어요. 잠시 후 새로고침해 주세요.");
      } finally {
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [ready]);

  const save = useCallback(
    async (field: MemoryField) => {
      const value = (drafts[field] ?? "").trim();
      if (!value) return;
      setSaving(field);
      setError(null);
      try {
        const saved = await saveMemoryField(field, value);
        setItems((prev) => ({ ...prev, [field]: saved }));
        setSavedField(field);
        window.setTimeout(() => setSavedField(null), 1500);
      } catch {
        setError("저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
      } finally {
        setSaving(null);
      }
    },
    [drafts],
  );

  const removeOne = useCallback(async (field: MemoryField, label: string) => {
    if (
      !window.confirm(
        `'${label}'을 지울까요? 코치가 다음 연습에서 이 내용을 참고하지 않게 됩니다.`,
      )
    )
      return;
    setError(null);
    try {
      await deleteMemoryField(field);
      setItems((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
      setDrafts((prev) => ({ ...prev, [field]: "" }));
    } catch {
      setError("지우지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
  }, []);

  const removeAll = useCallback(async () => {
    if (
      !window.confirm(
        "기억을 전부 지울까요? 코치가 나에 대해 알던 것이 모두 사라집니다. 되돌릴 수 없어요.",
      )
    )
      return;
    setError(null);
    try {
      await deleteAllMemory();
      setItems({});
      setDrafts({});
    } catch {
      setError("지우지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
  }, []);

  if (!ready) return null;

  const hasAny = Object.keys(items).length > 0;

  return (
    <main className="mx-auto w-full max-w-[720px] px-5 py-8">
      <Link
        href="/home"
        className="text-[13px] font-semibold text-[#8b95a1] transition hover:text-[#4e5968]"
      >
        ← 연습으로
      </Link>

      <h1 className="mt-4 text-[26px] font-black tracking-tight text-[#191f28]">
        코치가 기억하는 것
      </h1>
      <p className="mt-3 text-[15px] leading-[1.6] text-[#6b7684]">
        연습을 마칠 때마다 코치가 여기에 적어 둡니다. 다음 연습을 시작할 때 이 내용을
        참고해요.
        <br />
        틀린 게 있으면 고쳐주세요.{" "}
        <strong className="font-bold text-[#4e5968]">
          고친 내용은 코치가 다시 바꾸지 않습니다.
        </strong>
      </p>

      {error ? (
        <p
          role="alert"
          className="mt-5 rounded-xl bg-[#fff1f0] px-4 py-3 text-[14px] font-semibold text-[#d94a3d]"
        >
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="mt-8 text-[14px] text-[#8b95a1]">불러오는 중…</p>
      ) : (
        <>
          {!hasAny ? (
            <div className="mt-6 rounded-2xl bg-[#f9fafb] px-5 py-5">
              <p className="text-[15px] font-bold text-[#333d4b]">
                아직 적힌 게 없어요
              </p>
              <p className="mt-1.5 text-[14px] leading-[1.6] text-[#6b7684]">
                연습을 마치면 코치가 하나씩 적어 둡니다. 지금 직접 적어 두셔도 좋아요.
              </p>
            </div>
          ) : null}

          <div className="mt-6 flex flex-col gap-4">
            {FIELDS.map(({ field, label, hint, placeholder }) => {
              const item = items[field];
              const draft = drafts[field] ?? "";
              const dirty = draft.trim() !== (item?.value ?? "");
              const canSave = dirty && draft.trim().length > 0;
              return (
                <section
                  key={field}
                  className="rounded-2xl border border-[#edf0f3] p-5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-[16px] font-black text-[#191f28]">
                      {label}
                    </h2>
                    {item ? (
                      <span
                        className={`shrink-0 text-[12px] font-bold ${
                          item.edited_by_me ? "text-[#4e5968]" : "text-[#3182f6]"
                        }`}
                      >
                        {item.edited_by_me ? "내가 고침" : "코치가 적음"}
                      </span>
                    ) : (
                      <span className="shrink-0 text-[12px] text-[#b0b8c1]">
                        비어 있음
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[13px] text-[#8b95a1]">{hint}</p>

                  <label className="sr-only" htmlFor={`memory-${field}`}>
                    {label}
                  </label>
                  <textarea
                    id={`memory-${field}`}
                    value={draft}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [field]: e.target.value }))
                    }
                    placeholder={placeholder}
                    maxLength={MEMORY_VALUE_MAX_LENGTH}
                    rows={3}
                    className="mt-3 w-full resize-y rounded-xl border border-[#e5e8eb] px-3.5 py-3 text-[15px] leading-[1.6] text-[#191f28] outline-none transition placeholder:text-[#b0b8c1] focus:border-[#3182f6]"
                  />

                  {item?.source_practice_session_id && !item.edited_by_me ? (
                    <Link
                      href={`/home?session=${encodeURIComponent(item.source_practice_session_id)}`}
                      className="mt-1 inline-block text-[13px] font-semibold text-[#3182f6] transition hover:text-[#1b64da]"
                    >
                      이 말이 나온 연습 보기
                    </Link>
                  ) : null}

                  <div className="mt-3 flex items-center justify-between">
                    {item ? (
                      <button
                        type="button"
                        onClick={() => void removeOne(field, label)}
                        className="text-[14px] text-[#8b95a1] transition hover:text-[#4e5968]"
                      >
                        지우기
                      </button>
                    ) : (
                      <span />
                    )}
                    <button
                      type="button"
                      onClick={() => void save(field)}
                      disabled={!canSave || saving === field}
                      className={`rounded-xl px-5 py-2.5 text-[14px] font-bold text-white transition ${
                        canSave ? "bg-[#3182f6] hover:bg-[#1b64da]" : "bg-[#b0b8c1]"
                      }`}
                    >
                      {saving === field
                        ? "저장 중"
                        : savedField === field
                          ? "저장됨"
                          : "저장"}
                    </button>
                  </div>
                </section>
              );
            })}
          </div>

          {hasAny ? (
            <button
              type="button"
              onClick={() => void removeAll()}
              className="mx-auto mt-6 block py-3 text-[14px] text-[#8b95a1] transition hover:text-[#4e5968]"
            >
              기억 전부 지우기
            </button>
          ) : null}
        </>
      )}
    </main>
  );
}
