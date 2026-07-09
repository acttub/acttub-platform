import Link from "next/link";

const heroSignals = [
  ["대상", "배우 · 연기자"],
  ["입력", "연기 영상 + 장면 맥락"],
  ["결과", "질문 카드 + 연습 노트"],
];

const productFlow = [
  {
    label: "입력",
    title: "연기 영상 업로드",
    description: "MP4/MOV 영상과 장면의 상황, 인물, 숨은 의도를 적어요.",
  },
  {
    label: "질문",
    title: "확인된 단서로 질문",
    description: "보이는 관찰을 먼저 확인하고, 단정하지 않는 질문으로 이어가요.",
  },
  {
    label: "결과",
    title: "내 연습 노트 완성",
    description: "답변을 모아 다음 테이크에서 붙잡을 한 문장으로 정리해요.",
  },
];

const noteCards = [
  ["관찰", "상대의 말을 들은 뒤 숨을 고르는 순간이 보여요."],
  ["질문", "그 침묵에서 인물은 무엇을 얻고 싶었나요?"],
  ["노트", "확신보다 확인을 원했다."],
];

const outcomes = [
  ["놓친 순간", "영상 속 작은 멈춤과 반응을 다시 보게 해요."],
  ["장면 의도", "인물의 목표와 상대에게 기대한 것을 말로 붙잡아요."],
  ["다음 액션", "다음 테이크에서 바로 시도할 연습 문장을 남겨요."],
];

export default function Home() {
  return (
    <main className="min-h-dvh overflow-hidden bg-white text-[#191f28]">
      <header className="sticky top-0 z-20 border-b border-[#edf0f3]/80 bg-white/90 px-5 backdrop-blur-xl">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between">
          <Link href="/" className="text-xl font-black tracking-[-0.04em]">
            Acttub
          </Link>
          <div className="hidden items-center gap-8 text-sm font-semibold text-[#4e5968] sm:flex">
            <a href="#flow" className="transition hover:text-[#191f28]">
              서비스 흐름
            </a>
            <a href="#result" className="transition hover:text-[#191f28]">
              결과물
            </a>
            <Link href="/terms" className="transition hover:text-[#191f28]">
              안전 약속
            </Link>
          </div>
          <Link
            href="/practice"
            className="inline-flex h-10 items-center justify-center rounded-full bg-[#3182f6] px-4 text-sm font-bold text-white shadow-[0_8px_20px_rgba(49,130,246,0.24)] transition hover:bg-[#1b64da]"
          >
            질문 받기
          </Link>
        </nav>
      </header>

      <section className="relative bg-[linear-gradient(180deg,#eaf6ff_0%,#f8fbff_58%,#ffffff_100%)] px-5 pb-28 pt-20 text-center sm:pt-24">
        <div className="absolute left-1/2 top-12 h-80 w-80 -translate-x-1/2 rounded-full bg-[#b6dcff]/70 blur-3xl" />
        <div className="absolute left-[10%] top-28 hidden h-20 w-20 rotate-12 rounded-[28px] bg-white/75 shadow-[0_24px_80px_rgba(49,130,246,0.18)] md:block" />
        <div className="absolute right-[12%] top-40 hidden h-16 w-16 -rotate-12 rounded-[24px] bg-white/75 shadow-[0_24px_80px_rgba(49,130,246,0.18)] md:block" />

        <div className="relative mx-auto flex max-w-6xl flex-col items-center">
          <p className="rounded-full bg-white/85 px-4 py-2 text-sm font-black text-[#3182f6] shadow-sm">
            연기 영상 기반 질문 연습
          </p>
          <h1 className="mt-8 max-w-5xl text-5xl font-black leading-[1.06] tracking-[-0.065em] sm:text-6xl lg:text-7xl">
            내 연기 영상을 올리면
            <br />장면 질문이 도착해요
          </h1>
          <p className="mt-7 max-w-3xl text-lg font-semibold leading-8 text-[#4e5968] sm:text-xl">
            Acttub은 영상과 장면 맥락에서 확인한 단서만 질문으로 바꿔요.
            배우는 답을 쌓아 연습 노트와 다음 테이크 문장을 남깁니다.
          </p>

          <div className="mt-9 grid w-full max-w-3xl gap-3 sm:grid-cols-3">
            {heroSignals.map(([label, value]) => (
              <div
                key={label}
                className="rounded-2xl bg-white/80 px-5 py-4 text-left shadow-[0_16px_45px_rgba(25,31,40,0.06)] backdrop-blur"
              >
                <p className="text-xs font-black text-[#3182f6]">{label}</p>
                <p className="mt-1 text-base font-black tracking-[-0.03em] text-[#333d4b]">
                  {value}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-10 flex w-full max-w-lg flex-col gap-3 sm:flex-row sm:justify-center">
            <Link
              href="/practice"
              className="inline-flex h-14 items-center justify-center rounded-2xl bg-[#191f28] px-7 text-base font-black text-white shadow-[0_18px_40px_rgba(25,31,40,0.18)] transition hover:-translate-y-0.5 hover:bg-[#333d4b]"
            >
              내 장면으로 질문 받기
            </Link>
            <a
              href="#flow"
              className="inline-flex h-14 items-center justify-center rounded-2xl bg-white px-7 text-base font-black text-[#333d4b] shadow-[0_18px_40px_rgba(25,31,40,0.08)] transition hover:-translate-y-0.5"
            >
              어떻게 쓰는지 보기
            </a>
          </div>

          <div className="mt-16 w-full rounded-[44px] bg-white/85 p-4 shadow-[0_34px_100px_rgba(49,130,246,0.2)] backdrop-blur">
            <div className="grid gap-4 rounded-[32px] bg-white p-4 lg:grid-cols-[1fr_56px_1.05fr_56px_1fr] lg:items-center lg:p-6">
              <ProductPanel eyebrow="영상 업로드" title="오늘 연습한 장면" tone="gray">
                <div className="mt-5 rounded-[28px] bg-[#191f28] p-4 text-white shadow-[0_20px_45px_rgba(25,31,40,0.18)]">
                  <div className="aspect-video rounded-2xl bg-[linear-gradient(135deg,#4e5968,#dbeafe)] p-3 text-left">
                    <span className="rounded-full bg-white/90 px-2.5 py-1 text-xs font-black text-[#3182f6]">
                      take_03.mov
                    </span>
                  </div>
                  <div className="mt-4 grid gap-2 text-left text-sm font-bold text-[#d1d6db]">
                    <span>상황: 오디션 독백</span>
                    <span>목표: 상대의 확인을 얻기</span>
                  </div>
                </div>
              </ProductPanel>

              <FlowArrow />

              <div className="mx-auto flex h-[470px] w-full max-w-[248px] flex-col rounded-[42px] border-[10px] border-[#191f28] bg-[#f9fafb] p-4 shadow-[0_30px_70px_rgba(25,31,40,0.22)]">
                <div className="mx-auto h-1.5 w-16 rounded-full bg-[#333d4b]" />
                <div className="mt-7 rounded-3xl bg-white p-4 shadow-sm">
                  <p className="text-xs font-black text-[#3182f6]">질문 04</p>
                  <p className="mt-3 text-lg font-black leading-6 tracking-[-0.04em]">
                    이 침묵에서 인물은 무엇을 기대했나요?
                  </p>
                </div>
                <div className="mt-4 space-y-3 text-left">
                  {noteCards.map(([label, text]) => (
                    <div key={label} className="rounded-2xl bg-white px-4 py-3 shadow-sm">
                      <p className="text-xs font-black text-[#8b95a1]">{label}</p>
                      <p className="mt-1 text-sm font-black leading-5 tracking-[-0.03em]">
                        {text}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <FlowArrow />

              <ProductPanel eyebrow="연습 노트" title="다음 테이크 문장" tone="blue">
                <div className="mt-5 rounded-[28px] bg-white p-5 text-left shadow-sm">
                  <p className="text-sm font-black text-[#3182f6]">오늘 남긴 문장</p>
                  <p className="mt-4 text-2xl font-black leading-8 tracking-[-0.05em]">
                    “나는 확신보다 확인을 원했다.”
                  </p>
                  <div className="mt-5 rounded-2xl bg-[#f2f4f6] px-4 py-3 text-sm font-bold text-[#4e5968]">
                    다음 연습: 대답 전 2초를 더 듣기
                  </div>
                </div>
              </ProductPanel>
            </div>
          </div>
        </div>
      </section>

      <section id="flow" className="bg-[#f9fafb] px-5 py-28 sm:py-36">
        <div className="mx-auto max-w-5xl">
          <p className="text-lg font-black text-[#3182f6]">서비스 흐름</p>
          <h2 className="mt-4 max-w-3xl text-4xl font-black leading-tight tracking-[-0.05em] sm:text-5xl">
            처음 와도 바로 이해되는
            <br />3단계 연기 복기
          </h2>
          <div className="mt-14 grid gap-5 md:grid-cols-3">
            {productFlow.map((item) => (
              <article
                key={item.label}
                className="rounded-[32px] bg-white p-7 shadow-[0_18px_50px_rgba(25,31,40,0.06)]"
              >
                <p className="text-sm font-black text-[#3182f6]">{item.label}</p>
                <h3 className="mt-8 text-2xl font-black tracking-[-0.04em]">
                  {item.title}
                </h3>
                <p className="mt-4 text-base font-semibold leading-7 text-[#6b7684]">
                  {item.description}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="result" className="px-5 py-28 sm:py-40">
        <div className="mx-auto grid max-w-5xl gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div>
            <p className="text-lg font-black text-[#3182f6]">결과물</p>
            <h2 className="mt-4 text-4xl font-black leading-tight tracking-[-0.05em] sm:text-5xl">
              질문을 넘기면
              <br />연습 노트가 남아요
            </h2>
            <p className="mt-7 text-lg font-semibold leading-8 text-[#4e5968]">
              Acttub은 장면을 단정하지 않아요. 확인한 관찰만 질문의 근거로
              삼고, 마지막 문장은 배우가 직접 선택하게 합니다.
            </p>
            <Link
              href="/terms"
              className="mt-8 inline-flex h-12 items-center justify-center rounded-2xl bg-[#f2f4f6] px-5 text-sm font-black text-[#333d4b] transition hover:bg-[#e5e8eb]"
            >
              안전한 질문 원칙 보기
            </Link>
          </div>
          <div className="grid gap-4">
            {outcomes.map(([title, description]) => (
              <article
                key={title}
                className="rounded-[32px] bg-[#f2f4f6] p-7 transition hover:-translate-y-1 hover:bg-[#e8f3ff]"
              >
                <h3 className="text-3xl font-black tracking-[-0.05em] text-[#191f28]">
                  {title}
                </h3>
                <p className="mt-3 text-lg font-bold leading-8 text-[#4e5968]">
                  {description}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#191f28] px-5 py-24 text-white">
        <div className="mx-auto flex max-w-5xl flex-col items-start justify-between gap-10 md:flex-row md:items-center">
          <div>
            <p className="text-base font-bold text-[#8b95a1]">Ready to practice</p>
            <h2 className="mt-4 text-4xl font-black leading-tight tracking-[-0.05em] sm:text-5xl">
              오늘 찍은 장면으로
              <br />바로 질문을 받아보세요
            </h2>
          </div>
          <Link
            href="/practice"
            className="inline-flex h-16 items-center justify-center rounded-2xl bg-white px-8 text-lg font-black text-[#191f28] transition hover:-translate-y-0.5"
          >
            내 장면으로 질문 받기
          </Link>
        </div>
      </section>
    </main>
  );
}

function ProductPanel({
  eyebrow,
  title,
  tone,
  children,
}: {
  eyebrow: string;
  title: string;
  tone: "gray" | "blue";
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-[32px] p-6 text-left ${
        tone === "blue" ? "bg-[#e8f3ff]" : "bg-[#f2f4f6]"
      }`}
    >
      <p className="text-sm font-black text-[#3182f6]">{eyebrow}</p>
      <h3 className="mt-3 text-3xl font-black leading-tight tracking-[-0.05em]">
        {title}
      </h3>
      {children}
    </div>
  );
}

function FlowArrow() {
  return (
    <div className="hidden justify-center lg:flex" aria-hidden="true">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#e8f3ff] text-2xl font-black text-[#3182f6]">
        →
      </div>
    </div>
  );
}
