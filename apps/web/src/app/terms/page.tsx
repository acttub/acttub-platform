import { TermsGate } from "@/features/practice/terms-gate";

export default async function TermsPage() {
  const config = getAppConfig();
  const context = await getAuthContext();

  if (!context) {
    redirect("/auth/login");
  }

  if (context.termsAccepted) {
    redirect("/practice");
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center px-6 py-12">
      <p className="text-sm font-semibold text-[#3182f6]">Acttub 시작 전 확인</p>
      <h1 className="mt-3 text-3xl font-bold tracking-[-0.03em] text-[#191f28]">
        질문 연습을 안전하게 이어가기 위한 약속
      </h1>
      <div className="mt-8 rounded-3xl border border-[#e5e8eb] bg-white p-6 text-base leading-7 text-[#4e5968]">
        <p>
          Acttub은 결론을 대신 내리지 않고, 사용자가 직접 장면의 생각과
          선택을 정리하도록 질문을 건네는 연습 도구입니다.
        </p>
        <ul className="mt-5 list-disc space-y-2 pl-5">
          <li>영상과 장면 맥락은 질문 흐름을 만들기 위해 사용합니다.</li>
          <li>불확실한 관찰은 먼저 확인하고, 거절한 관찰은 질문 근거로 다시 쓰지 않습니다.</li>
          <li>마지막 문장은 AI가 아니라 사용자가 직접 남깁니다.</li>
        </ul>
      </div>
      <form action="/api/v1/terms/acceptances" method="post" className="mt-8">
        <input type="hidden" name="termsVersion" value={config.termsVersion} />
        <button className="h-14 w-full rounded-2xl bg-[#3182f6] px-5 text-base font-semibold text-white transition hover:bg-[#1b64da]">
          확인하고 연습 시작하기
        </button>
      </form>
      <p className="mt-4 text-sm text-[#8b95a1]">약관 버전: {config.termsVersion}</p>
    </main>
  );
}
