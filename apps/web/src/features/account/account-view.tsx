"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";

import { SubscriptionCard } from "@/features/billing/subscription-card";
import { fetchMe, logout, withdraw, type Me } from "@/lib/api/v2/auth";
import { errorMessage } from "@/lib/api/v2/errors";
import { fetchMyInquiries, type MyInquiry } from "@/lib/api/v2/support";
import { memberProvider, setMemberTokens, getAccessToken, getRefreshToken, subscribeAuthChange } from "@/lib/auth/token-store";

import { PROVIDER_NAME, inquiryStatus, maskEmail, shortDate } from "./account-format";
import { loadMarketing, saveMarketing, type MarketingState } from "./marketing-consent";

type Loaded = { kind: "member"; me: Me } | { kind: "error"; message: string };
type Inquiries = { kind: "loading" } | { kind: "unavailable" } | { kind: "ready"; items: MyInquiry[] };

const SECTION = "border-t border-[#edf0f3] pt-10";

/** 내 계정(SOMA-834). 로그인하지 않았으면 로그인 안내만 보이고, 아래 삭제 안내는 누구에게나 보인다. */
export function AccountView() {
  // null = 아직 브라우저를 못 봤다(서버 그림), "" = 회원 아님, 그 밖 = 로그인한 제공자.
  const provider = useSyncExternalStore(subscribeAuthChange, () => memberProvider() ?? "", () => null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [withdrawn, setWithdrawn] = useState(false);

  useEffect(() => {
    const left = new URLSearchParams(window.location.search).get("withdrawn") === "1";
    void Promise.resolve().then(() => setWithdrawn(left));
  }, []);

  useEffect(() => {
    if (!provider) return;
    let cancelled = false;
    fetchMe()
      .then((me) => {
        if (cancelled) return;
        setLoaded({ kind: "member", me });
        // 상단 메뉴의 「<이름> 님」을 채운다(로그인 때 이름을 못 받았거나 앱에서 바꾼 경우).
        const access = getAccessToken();
        const refresh = getRefreshToken();
        if (access && refresh) setMemberTokens({ access_token: access, refresh_token: refresh }, { id: me.id, email: me.email, status: me.status, name: me.profile?.name ?? null }, provider);
      })
      .catch((error) => !cancelled && setLoaded({ kind: "error", message: errorMessage(error, "계정 정보를 불러오지 못했어요.") }));
    return () => {
      cancelled = true;
    };
  }, [provider]);

  if (provider === null || (provider !== "" && !loaded)) {
    return (
      <div aria-hidden="true" className="space-y-4">
        <div className="h-7 w-24 animate-pulse rounded bg-[#e5e8eb]" />
        <div className="h-32 animate-pulse rounded-[28px] bg-[#f2f4f6]" />
        <div className="h-4 w-56 animate-pulse rounded bg-[#e5e8eb]" />
      </div>
    );
  }

  if (provider === "" && withdrawn) {
    return (
      <section role="status">
        <h2 className="text-xl font-black">탈퇴가 끝났어요</h2>
        <p className="mt-2 text-base leading-7 text-[#4e5968]">그동안 ACTTUB을 써 주셔서 고마워요. App Store·Google Play에서 구독했다면 그곳에서 따로 해지해 주세요.</p>
        <Link href="/" className="mt-4 inline-block text-sm font-semibold text-[#3182f6]">처음으로</Link>
      </section>
    );
  }

  if (provider === "") {
    return (
      <section>
        <p className="text-base leading-7 text-[#4e5968]">로그인하면 구독과 문의를 확인하고, 로그아웃과 탈퇴를 할 수 있어요.</p>
        <Link href="/login?next=/account" className="mt-5 inline-flex h-14 items-center rounded-2xl bg-[#3182f6] px-8 text-[17px] font-bold text-white">로그인</Link>
        <p className="mt-4 text-[15px] text-[#4e5968]">
          계정이 없나요? <Link href="/signup" className="font-bold text-[#3182f6]">가입하기</Link>
        </p>
      </section>
    );
  }

  if (!loaded || loaded.kind === "error") {
    return (
      <section role="alert">
        <p className="text-base">{loaded?.kind === "error" ? loaded.message : "계정 정보를 불러오지 못했어요."}</p>
        <Link href="/login?next=/account" className="mt-3 inline-block font-semibold text-[#3182f6]">다시 로그인하기</Link>
      </section>
    );
  }

  return <MemberAccount me={loaded.me} provider={provider} onError={(message) => setLoaded({ kind: "error", message })} />;
}

function MemberAccount({ me, provider, onError }: { me: Me; provider: string; onError: (message: string) => void }) {
  const [inquiries, setInquiries] = useState<Inquiries>({ kind: "loading" });
  const [marketing, setMarketing] = useState<MarketingState>(null);
  const [marketingBusy, setMarketingBusy] = useState(false);
  const [marketingError, setMarketingError] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchMyInquiries({ signal: controller.signal })
      .then((items) => setInquiries({ kind: "ready", items }))
      .catch((error: { name?: string }) => {
        if (error?.name === "AbortError") return;
        // 서버가 아직 이 경로를 모르거나(404) 불러오지 못하면 목록은 숨기고 문의하기 링크만 둔다.
        setInquiries({ kind: "unavailable" });
      });
    loadMarketing(controller.signal)
      .then(setMarketing)
      .catch(() => setMarketing(null));
    return () => controller.abort();
  }, []);

  async function toggleMarketing() {
    if (!marketing || marketingBusy) return;
    const next = !marketing.on;
    setMarketingBusy(true);
    setMarketingError(false);
    try {
      await saveMarketing(marketing.documentIds, next);
      setMarketing({ ...marketing, on: next });
    } catch {
      setMarketingError(true);
    } finally {
      setMarketingBusy(false);
    }
  }

  async function doLogout() {
    setPending("로그아웃하는 중이에요");
    await logout().catch(() => undefined);
    window.location.assign("/");
  }

  async function doWithdraw() {
    setPending("탈퇴하는 중이에요");
    try {
      await withdraw();
      window.location.assign("/account?withdrawn=1");
    } catch (error) {
      setPending(null);
      setConfirming(false);
      onError(errorMessage(error, "탈퇴하지 못했어요. 잠시 뒤 다시 시도해 주세요."));
    }
  }

  return (
    <div className="space-y-10">
      <SubscriptionCard />

      <section aria-labelledby="account-info" className={SECTION}>
        <h2 id="account-info" className="text-xl font-black">계정</h2>
        <dl className="mt-5 space-y-4 text-base leading-7">
          <div className="flex gap-6"><dt className="w-20 shrink-0 text-[#8b95a1]">이름</dt><dd>{me.profile?.name || "아직 없어요"}</dd></div>
          <div className="flex gap-6"><dt className="w-20 shrink-0 text-[#8b95a1]">이메일</dt><dd>{maskEmail(me.email)}</dd></div>
          <div className="flex gap-6"><dt className="w-20 shrink-0 text-[#8b95a1]">로그인</dt><dd>{PROVIDER_NAME[provider] ?? provider}</dd></div>
        </dl>
        <p className="mt-5 text-sm leading-6 text-[#8b95a1]">사진·소개 같은 프로필은 앱 프로필 탭에서 바꿔요.</p>
      </section>

      <section aria-labelledby="account-inquiries" className={SECTION}>
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="account-inquiries" className="text-xl font-black">내 문의</h2>
          <Link href="/help/contact" className="text-[15px] font-semibold text-[#3182f6]">새 문의하기</Link>
        </div>
        {inquiries.kind === "ready" ? (
          inquiries.items.length === 0 ? (
            <p className="mt-4 text-[15px] leading-7 text-[#8b95a1]">아직 보낸 문의가 없어요.</p>
          ) : (
            <ul className="mt-3 divide-y divide-[#f2f4f6]">
              {inquiries.items.map((item) => {
                const status = inquiryStatus(item.status);
                return (
                  <li key={item.id} className="flex items-center gap-3 py-4">
                    <span className={`shrink-0 rounded-lg px-2.5 py-1 text-[13px] font-bold ${status.tone === "blue" ? "bg-[#e8f3ff] text-[#1b64da]" : "bg-[#f2f4f6] text-[#4e5968]"}`}>{status.label}</span>
                    <span className="min-w-0 flex-1 truncate text-[15px]">{item.summary}</span>
                    <span className="shrink-0 text-sm text-[#8b95a1]">{shortDate(item.created_at)}</span>
                  </li>
                );
              })}
            </ul>
          )
        ) : null}
      </section>

      {marketing ? (
        <section aria-labelledby="account-notify" className={SECTION}>
          <h2 id="account-notify" className="text-xl font-black">알림</h2>
          <div className="mt-5 flex items-center justify-between gap-4">
            <span id="marketing-label" className="text-base">혜택·이벤트 소식 받기</span>
            <button
              type="button"
              role="switch"
              aria-checked={marketing.on}
              aria-labelledby="marketing-label"
              disabled={marketingBusy}
              onClick={() => void toggleMarketing()}
              className={`relative h-8 w-14 shrink-0 rounded-full transition ${marketing.on ? "bg-[#3182f6]" : "bg-[#d1d6db]"}`}
            >
              <span className={`absolute top-1 h-6 w-6 rounded-full bg-white transition-all ${marketing.on ? "left-7" : "left-1"}`} />
            </button>
          </div>
          {marketingError ? <p role="alert" className="mt-3 text-sm text-[#f04452]">바꾸지 못했어요. 잠시 뒤 다시 시도해 주세요.</p> : null}
        </section>
      ) : null}

      <section className={SECTION}>
        {!confirming ? (
          <div className="flex gap-6 text-[15px] text-[#8b95a1]">
            <button type="button" disabled={pending !== null} onClick={() => void doLogout()}>로그아웃</button>
            <button type="button" disabled={pending !== null} onClick={() => setConfirming(true)}>회원 탈퇴</button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm leading-6 text-[#4e5968]">
              탈퇴하면 되돌릴 수 없어요. 아래 안내를 확인했다면 한 번 더 눌러 주세요.
              <br />
              <span className="font-semibold text-[#191f28]">탈퇴해도 App Store·Google Play 구독은 자동으로 해지되지 않아요.</span>
            </p>
            <div className="flex gap-2">
              <button type="button" disabled={pending !== null} onClick={() => void doWithdraw()} className="rounded-2xl bg-[#f04452] px-4 py-2.5 text-sm font-bold text-white">탈퇴</button>
              <button type="button" disabled={pending !== null} onClick={() => setConfirming(false)} className="rounded-2xl px-4 py-2.5 text-sm font-bold text-[#4e5968] ring-1 ring-[#e5e8eb]">그만두기</button>
            </div>
          </div>
        )}
        {pending ? <p role="status" className="mt-4 text-sm font-semibold text-[#4e5968]">{pending}</p> : null}
      </section>
    </div>
  );
}
