import { requireTermsAccepted } from "@/server/services/auth-context";

export default async function PracticePage() {
  const context = await requireTermsAccepted();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-6 py-10">
      <p className="text-sm font-semibold text-[#3182f6]">Acttub 연습 공간</p>
      <h1 className="mt-3 text-3xl font-bold tracking-[-0.03em] text-[#191f28]">
        오늘의 영상을 올리고, 한 번에 하나씩 다시 생각해 봐요.
      </h1>
      <section className="mt-8 rounded-3xl border border-dashed border-[#d1d6db] bg-[#f9fafb] p-6">
        <h2 className="text-xl font-bold text-[#191f28]">Slice 1 준비 완료</h2>
        <p className="mt-3 leading-7 text-[#4e5968]">
          인증, 약관 확인, Supabase 연결 경계가 준비되어 있어요. Supabase 환경
          변수가 없어도 로컬 개발 모드로 다음 화면을 이어 붙일 수 있습니다.
        </p>
        <dl className="mt-5 grid gap-3 text-sm text-[#4e5968] sm:grid-cols-2">
          <div className="rounded-2xl bg-white p-4">
            <dt className="font-semibold text-[#191f28]">사용자</dt>
            <dd className="mt-1">{context.email ?? context.userId}</dd>
          </div>
          <div className="rounded-2xl bg-white p-4">
            <dt className="font-semibold text-[#191f28]">모드</dt>
            <dd className="mt-1">{context.mode}</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
