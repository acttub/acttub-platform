"use client";

import { usePathname } from "next/navigation";
import { useOptionalAuth } from "./use-optional-auth";
import { useRequireAuth } from "./use-require-auth";

const ENTRY_EXEMPT_PATHS = new Set(["/", "/app", "/login", "/terms"]);

/**
 * 익명 방문자에게 열린 화면은 그대로 두되, 로그인한 배우는 어느 서비스 주소를 직접
 * 열어도 서버의 동의 진입 결과를 확인하기 전까지 내용을 보지 못하게 한다.
 */
export function ConsentEntryBoundary({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { loggedIn } = useOptionalAuth();

  if (!loggedIn || ENTRY_EXEMPT_PATHS.has(pathname)) return children;
  return <AuthenticatedConsentEntryBoundary>{children}</AuthenticatedConsentEntryBoundary>;
}

function AuthenticatedConsentEntryBoundary({
  children,
}: {
  children: React.ReactNode;
}) {
  const { ready, entryError, retryEntry } = useRequireAuth();
  if (ready) return children;
  if (entryError) {
    return <EntryFailure message={entryError} onRetry={retryEntry} />;
  }
  return <div className="min-h-dvh bg-white" aria-busy="true" />;
}

function EntryFailure({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#f2f4f6] px-5 py-12 text-[#191f28]">
      <section className="w-full max-w-md rounded-[28px] bg-white p-7 shadow-[0_20px_64px_rgba(25,31,40,0.08)]">
        <p className="text-sm font-black text-[#3182f6]">Acttub 시작 전 확인</p>
        <h1 className="mt-3 text-2xl font-black tracking-[-0.04em]">
          동의 결정을 확인하지 못했어요
        </h1>
        <p role="alert" className="mt-4 text-sm font-semibold leading-6 text-[#6b7684]">
          {message}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-7 h-12 w-full rounded-2xl bg-[#3182f6] px-4 text-sm font-black text-white transition hover:bg-[#1b64da]"
        >
          다시 시도하기
        </button>
      </section>
    </main>
  );
}
