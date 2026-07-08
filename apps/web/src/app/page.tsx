import Link from "next/link";

  return (
    <main className="min-h-dvh bg-[#f2f4f6] px-5 py-8 text-[#191f28] sm:px-8">
      <section className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-5xl flex-col justify-between rounded-[2.5rem] bg-white p-7 shadow-sm sm:p-10">
        <nav className="flex items-center justify-between text-sm">
          <strong className="text-[#3182f6]">Acttub</strong>
          <Link href="/practice" className="font-semibold text-[#4e5968]">
            연습 공간 열기
          </Link>
        </nav>

        <div className="max-w-3xl py-16">
          <p className="text-sm font-semibold text-[#3182f6]">배우가 직접 정리하는 질문 연습</p>
          <h1 className="mt-5 text-4xl font-bold tracking-[-0.05em] sm:text-6xl">
            장면을 단정하지 않고, 질문으로 다음 테이크를 준비해요.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-[#4e5968]">
            영상과 장면 맥락을 바탕으로 관찰을 먼저 확인하고, 한 번에 하나의 질문만 이어갑니다.
            마지막 문장은 AI가 아니라 사용자가 직접 남깁니다.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/practice"
              className="flex h-14 items-center justify-center rounded-2xl bg-[#3182f6] px-6 font-semibold text-white transition hover:bg-[#1b64da]"
            >
              새 연습 시작하기
            </Link>
            <Link
              href="/terms"
              className="flex h-14 items-center justify-center rounded-2xl border border-[#d1d6db] px-6 font-semibold text-[#4e5968]"
            >
              안전 약속 보기
            </Link>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {[
            ["확인 먼저", "불확실한 관찰은 사용자에게 먼저 확인합니다."],
            ["하나씩", "질문은 한 번에 하나만 보여 주어 생각을 좁혀 갑니다."],
            ["내 문장", "마무리는 사용자가 직접 쓴 인물의 생각으로 남깁니다."],
          ].map(([title, body]) => (
            <article key={title} className="rounded-3xl bg-[#f9fafb] p-5">
              <h2 className="font-bold">{title}</h2>
              <p className="mt-2 leading-7 text-[#4e5968]">{body}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
