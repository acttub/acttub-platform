/** 형식을 보여 주기 위한 짧은 샘플. 창작물이라 저작권 문제가 없다. */
import { isKorean } from '../i18n.ts';

const ROOFTOP = `옥상, 밤

(옥상 난간. 도시 불빛. 바람 소리.)

윤서: 여기 있을 줄 알았어.
태오: 어떻게 알았어.
윤서: 너 힘들면 항상 높은 데로 가잖아.
태오: (웃으며) 그런가.
윤서: 왜 말 안 했어. 오디션 떨어진 거.
태오: 말하면 뭐가 달라져.
윤서: 달라지지. 나는 알잖아, 네가 그거 얼마나 준비했는지.
태오: 그래서 더 말하기 싫었어. 네가 그걸 아니까.

(사이. 태오가 난간에 기댄다.)

윤서: 다음 거 언제야.
태오: 모레.
윤서: 그럼 오늘은 내려가자. 대본은 내가 상대역 해줄게.
태오: 너 연기 못하잖아.
윤서: 알아. 그래도 혼자 하는 것보단 낫지.
태오: (한참 보다가) 고마워.
윤서: 가자. 춥다.`;


const CAFE = `카페, 헤어지자는 말

(창가 자리. 식은 커피 두 잔.)

서연: 일찍 왔네.
준호: 어, 조금. 앉아.
서연: 할 말 있다며. 메시지가 좀 이상하더라.
준호: 응. 오래 생각했어.
서연: 그래서?
준호: 우리, 이제 그만하는 게 맞는 것 같아.
서연: (잠시 말이 없다가) 갑자기가 아니라는 말이지.
준호: 갑자기는 아니야. 나도 몇 달 됐어.
서연: 나는 몰랐어. 그게 제일 서운해.
준호: 말하려고 했는데 매번 타이밍을 놓쳤어.
서연: 타이밍 탓은 하지 마.
준호: 미안. 그건 내가 비겁했어.

(사이. 서연이 컵을 만지작거린다.)

서연: 알겠어. 대신 오늘은 내가 먼저 일어날게.
준호: 그래.
서연: 잘 지내.`;

const MINJI = `민지의 독백

(퇴근길. 버스 창문에 이마를 기댄 채.)

오늘도 괜찮다고 말했다. 정말 괜찮았던 건지는 잘 모르겠다. 엄마한테 전화가 왔는데 일부러 받지 않았다. 목소리를 들으면 울 것 같아서였다. 집에 가면 불부터 켜야지. 물도 한 잔 마셔야지. 그러고 나면 조금은 나아질 거라고 믿어 보기로 했다.`;

/** 영어 기기의 예시(SOMA-1033). 서버 reading_examples(language='en')의 raw_text 와 글자 그대로 같다. */
const ROOFTOP_EN = `Rooftop, night

(Rooftop railing. City lights. Wind.)

Ellie: Knew I'd find you up here.
Theo: How'd you know?
Ellie: You always go somewhere high when things get bad.
Theo: (smiles) Do I?
Ellie: Why didn't you tell me? About the audition.
Theo: What would telling you change?
Ellie: Everything. I know how hard you worked for that one.
Theo: That's exactly why I didn't want to tell you.

(Beat. Theo leans on the railing.)

Ellie: When's the next one?
Theo: Day after tomorrow.
Ellie: Then let's go down. I'll read the other part for you.
Theo: You can't act.
Ellie: I know. Still better than doing it alone.
Theo: (looks at her for a while) Thanks.
Ellie: Come on. It's cold.`;

const CAFE_EN = `Café, the breakup talk

(A window seat. Two cups of coffee gone cold.)

Hannah: You're early.
Josh: Yeah, a little. Sit down.
Hannah: You said you had something to tell me. Your text sounded off.
Josh: Yeah. I've been thinking about it for a long time.
Hannah: And?
Josh: I think we should stop. Us, I mean.
Hannah: (silent for a moment) So this isn't sudden.
Josh: No. It's been a few months for me.
Hannah: I had no idea. That's the part that hurts most.
Josh: I kept meaning to say it. The timing was never right.
Hannah: Don't blame the timing.
Josh: Sorry. That was cowardly of me.

(Beat. Hannah turns her cup in her hands.)

Hannah: Okay. But today, I'm the one who leaves first.
Josh: Okay.
Hannah: Take care.`;

const MIA_EN = `Mia's monologue

(On the way home from work. Forehead against the bus window.)

I told everyone I was fine again today. I'm not sure I actually was. Mom called, and I let it ring. I knew if I heard her voice, I'd cry. When I get home, I'll turn the lights on first. Drink a glass of water. Then I'm going to let myself believe it'll get a little better.`;

export type SampleEntry = { id: string; title: string; text: string; summary: string };

/** 「예시 대본 고르기」 목록 — 모두 이 앱을 위해 새로 쓴 짧은 창작물이다. */
export const SAMPLE_SCRIPTS: readonly SampleEntry[] = [
  { id: 'rooftop', title: '옥상, 밤', text: ROOFTOP, summary: '윤서 · 태오 · 2인 대화' },
  { id: 'cafe', title: '카페, 헤어지자는 말', text: CAFE, summary: '서연 · 준호 · 2인 대화' },
  { id: 'minji', title: '민지의 독백', text: MINJI, summary: '혼자 읽는 독백' },
];

/** 영어 기기의 「예시 대본 고르기」 목록 — 위 셋을 뜻 그대로 영어로 옮겼다(SOMA-1033). */
export const SAMPLE_SCRIPTS_EN: readonly SampleEntry[] = [
  { id: 'rooftop-en', title: 'Rooftop, night', text: ROOFTOP_EN, summary: 'Ellie · Theo · 2-person scene' },
  { id: 'cafe-en', title: 'Café, the breakup talk', text: CAFE_EN, summary: 'Hannah · Josh · 2-person scene' },
  { id: 'mia-en', title: "Mia's monologue", text: MIA_EN, summary: 'Solo monologue' },
];

/** 지금 화면 언어의 예시 목록. */
export function localSamples(): readonly SampleEntry[] {
  return isKorean() ? SAMPLE_SCRIPTS : SAMPLE_SCRIPTS_EN;
}

export const SAMPLE_SCRIPT = ROOFTOP;

export function sampleById(id: string | null | undefined): SampleEntry {
  return SAMPLE_SCRIPTS.find((s) => s.id === id) ?? SAMPLE_SCRIPTS_EN.find((s) => s.id === id) ?? localSamples()[0];
}

/** 미리보기용 — 제목을 뺀 본문에서 대사·지문 앞부분. */
export function samplePreview(entry: SampleEntry, max = 5): { speaker: string | null; text: string }[] {
  const out: { speaker: string | null; text: string }[] = [];
  for (const raw of entry.text.split('\n').slice(1)) {
    const line = raw.trim();
    if (!line || line.startsWith('(')) continue;
    const m = /^([^:：\s]{1,12})[:：]\s*(.+)$/.exec(line);
    out.push(m ? { speaker: m[1], text: m[2] } : { speaker: null, text: line });
    if (out.length >= max) break;
  }
  return out;
}

export function dialogueCount(entry: SampleEntry): number {
  return entry.text.split('\n').slice(1).filter((l) => /^[^:：\s(]{1,12}[:：]/.test(l.trim())).length;
}
