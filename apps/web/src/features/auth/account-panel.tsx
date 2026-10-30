"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { fetchMe, logout, withdraw, type Me } from "@/lib/api/v2/auth";
import { errorMessage } from "@/lib/api/v2/errors";
import { memberProvider, subscribeAuthChange } from "@/lib/auth/token-store";
import { SubscriptionCard } from "@/features/billing/subscription-card";
import { hasPendingCarry, redeemGuestCarry, takeCarryStatus, type CarryOutcome } from "./carry-guest";

const PROVIDER_NAME: Record<string, string> = { google: "구글", naver: "네이버", kakao: "카카오", apple: "애플" };

type Loaded = { kind: "member"; me: Me } | { kind: "error"; message: string };

/** 내 계정(SOMA-834). 로그인하지 않았으면 로그인 안내만 보이고, 아래 삭제 안내는 누구에게나 보인다. */
export function AccountPanel() {
  // null = 아직 브라우저를 못 봤다(서버 그림), "" = 회원 아님, 그 밖 = 로그인한 제공자.
  const provider = useSyncExternalStore(subscribeAuthChange, () => memberProvider() ?? "", () => null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [carry, setCarry] = useState<CarryOutcome | "pending" | null>(null);
  const [withdrawn, setWithdrawn] = useState(false);

  useEffect(() => {
    // 로그인 직후의 옮기기 결과와 탈퇴 완료 표시는 한 번만 읽는다.
    const status = takeCarryStatus();
    const left = new URLSearchParams(window.location.search).get("withdrawn") === "1";
    void Promise.resolve().then(() => {
      if (status === "moved") setCarry("moved");
      else if (status === "failed" || hasPendingCarry()) setCarry("failed");
      setWithdrawn(left);
    });
  }, []);

  async function retryCarry() {
    setCarry("pending");
    const result = await redeemGuestCarry();
    takeCarryStatus();
    setCarry(result === "moved" ? "moved" : hasPendingCarry() ? "failed" : null);
  }

  useEffect(() => {
    if (!provider) return;
    let cancelled = false;
    fetchMe()
      .then((me) => !cancelled && setLoaded({ kind: "member", me }))
      .catch((error) => !cancelled && setLoaded({ kind: "error", message: errorMessage(error, "계정 정보를 불러오지 못했어요.") }));
    return () => {
      cancelled = true;
    };
  }, [provider]);

  const state =
    provider === null ? { kind: "checking" as const }
    : provider === "" ? { kind: "guest" as const }
    : loaded ?? { kind: "loading" as const };

  const card = "rounded-[28px] bg-white p-6 ring-1 ring-[#e5e8eb] sm:p-8";

  if (state.kind === "checking" || state.kind === "loading") {
    return (
      <section aria-hidden="true" className={card}>
        <div className="h-6 w-32 animate-pulse rounded bg-[#e5e8eb]" />
        <div className="mt-4 h-4 w-56 animate-pulse rounded bg-[#e5e8eb]" />
        <div className="mt-2 h-4 w-40 animate-pulse rounded bg-[#e5e8eb]" />
      </section>
    );
  }

  if (state.kind === "guest" && withdrawn) {
    return (
      <section role="status" className={card}>
        <h2 className="text-xl font-black">탈퇴가 끝났어요</h2>
        <p className="mt-2 text-sm leading-6 text-[#4e5968]">그동안 ACTTUB을 써 주셔서 고마워요. App Store·Google Play에서 구독했다면 그곳에서 따로 해지해 주세요.</p>
        <Link href="/" className="mt-4 inline-block text-sm font-semibold text-[#3182f6]">처음으로</Link>
      </section>
    );
  }

  if (state.kind === "guest") {
    return (
      <section className={card}>
        <h2 className="text-xl font-black">내 계정</h2>
        <p className="mt-2 text-sm leading-6 text-[#4e5968]">앱에서 만든 계정으로 로그인하면 로그아웃과 탈퇴를 웹에서도 할 수 있어요.</p>
        <Link href="/login?next=/account" className="mt-4 inline-block rounded-2xl bg-[#3182f6] px-5 py-3 font-bold text-white">로그인</Link>
      </section>
    );
  }

  if (state.kind === "error") {
    return (
      <section role="alert" className={card}>
        <p className="text-base">{state.message}</p>
        <Link href="/login?next=/account" className="mt-3 inline-block font-semibold text-[#3182f6]">다시 로그인하기</Link>
      </section>
    );
  }

  const { me } = state;

  async function doLogout() {
    setPending("로그아웃하는 중이에요");
    await logout().catch(() => undefined);
    window.location.assign("/home");
  }

  async function doWithdraw() {
    setPending("탈퇴하는 중이에요");
    try {
      await withdraw();
      window.location.assign("/account?withdrawn=1");
    } catch (error) {
      setPending(null);
      setConfirming(false);
      setLoaded({ kind: "error", message: errorMessage(error, "탈퇴하지 못했어요. 잠시 뒤 다시 시도해 주세요.") });
    }
  }

  return (
    <>
      <section className={card}>
        <h2 className="text-xl font-black">내 계정</h2>
        <dl className="mt-4 space-y-2 text-sm leading-6">
          <div className="flex gap-3"><dt className="w-20 text-[#8b95a1]">이름</dt><dd>{me.profile?.name || "아직 없어요"}</dd></div>
          <div className="flex gap-3"><dt className="w-20 text-[#8b95a1]">이메일</dt><dd>{me.email ?? "없어요"}</dd></div>
          <div className="flex gap-3"><dt className="w-20 text-[#8b95a1]">로그인</dt><dd>{PROVIDER_NAME[provider ?? ""] ?? provider}</dd></div>
        </dl>
        {!me.profile_complete ? (
          <p className="mt-4 rounded-2xl bg-[#f2f4f6] p-4 text-sm leading-6 text-[#4e5968]">
            앱에서 프로필을 마저 채우면 웹에서도 코칭과 리딩을 이어서 쓸 수 있어요.
          </p>
        ) : null}
        {carry === "moved" ? (
          <p role="status" className="mt-4 rounded-2xl bg-[#e8f3ff] p-4 text-sm leading-6 text-[#1b64da]">이 브라우저에서 한 연습을 내 계정으로 옮겼어요.</p>
        ) : null}
        {carry === "failed" || carry === "pending" ? (
          <div role="status" className="mt-4 rounded-2xl bg-[#fff8ec] p-4 text-sm leading-6 text-[#8a4b00]">
            이 브라우저에서 한 연습을 아직 옮기지 못했어요. 연습은 이 브라우저에 그대로 있어요.
            {!me.profile_complete ? " 앱에서 프로필을 채운 뒤 다시 시도해 주세요." : null}
            <button type="button" disabled={carry === "pending"} onClick={() => void retryCarry()} className="ml-2 font-bold underline underline-offset-2">
              {carry === "pending" ? "옮기는 중이에요" : "다시 옮기기"}
            </button>
          </div>
        ) : null}
        <button type="button" disabled={pending !== null} onClick={() => void doLogout()} className="mt-5 rounded-2xl px-4 py-2.5 text-sm font-bold text-[#4e5968] ring-1 ring-[#e5e8eb]">
          로그아웃
        </button>
      </section>

      <SubscriptionCard />

      <section className={card}>
        <h2 className="text-xl font-black">회원 탈퇴</h2>
        {!confirming ? (
          <button type="button" onClick={() => setConfirming(true)} className="mt-3 text-sm font-semibold text-[#f04452]">탈퇴하기</button>
        ) : (
          <div className="mt-3 space-y-3">
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
      </section>
      {pending ? <p role="status" className="text-center text-sm font-semibold text-[#4e5968]">{pending}</p> : null}
    </>
  );
}
