const VERBS = ["대본을 외우고", "내 연기를 찍고", "코멘트 받고", "다시 연습하고"] as const;

/** 배우가 실제로 하는 일을 큰 글자로 늘어놓은 띠. 움직이지 않는다. */
export function VerbBand() {
  return (
    <section aria-label="액터브에서 하는 일" className="bg-[#ffa21f] text-[#151a30]">
      <ul className="mx-auto grid max-w-[1200px] gap-x-10 px-5 py-9 sm:grid-cols-2 sm:px-8 lg:flex lg:justify-between lg:py-12">
        {VERBS.map((v) => (
          <li key={v} className="text-[clamp(28px,4.2vw,44px)] font-black leading-[1.25] tracking-[-0.05em]">
            {v}
          </li>
        ))}
      </ul>
    </section>
  );
}
