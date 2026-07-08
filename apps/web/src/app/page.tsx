import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-dvh bg-[#f9fafb] px-6 py-10 text-[#191f28]">
      <section className="mx-auto flex w-full max-w-3xl flex-col justify-center rounded-[32px] bg-white px-6 py-10 sm:px-10 sm:py-14">
        <p className="text-sm font-semibold text-[#3182f6]">Acttub</p>
        <h1 className="mt-4 text-4xl font-bold tracking-[-0.04em] sm:text-5xl">
          영상을 올리고, 장면을 한 질문씩 다시 생각해요.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-[#4e5968]">
          Acttub은 배우가 자기 연기 영상과 장면 맥락을 바탕으로 놓쳤던
          생각, 관계, 목표를 스스로 정리하도록 돕는 질문 기반 연습 도구입니다.
        </p>
        <div className="mt-9 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/practice"
            className="inline-flex h-14 items-center justify-center rounded-2xl bg-[#3182f6] px-6 text-base font-semibold text-white transition hover:bg-[#1b64da]"
          >
            연습 시작하기
          </Link>
          <Link
            href="/terms"
            className="inline-flex h-14 items-center justify-center rounded-2xl border border-[#d1d6db] px-6 text-base font-semibold text-[#333d4b]"
          >
            안전 약속 보기
          </Link>
        </div>
      </section>

      <section id="how-it-works" className="mx-auto mt-6 grid w-full max-w-3xl gap-3 sm:grid-cols-3">
        {[
          ["1", "영상과 장면 맥락을 준비해요"],
          ["2", "확인한 단서만 질문의 바탕으로 삼아요"],
          ["3", "마지막 문장은 배우가 직접 남겨요"],
        ].map(([step, text]) => (
          <div key={step} className="rounded-3xl bg-white p-5">
            <p className="text-sm font-bold text-[#3182f6]">{step}</p>
            <p className="mt-3 font-semibold leading-7 text-[#333d4b]">{text}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
