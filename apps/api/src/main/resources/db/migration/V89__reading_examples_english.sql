-- 영어 예시 대본(SOMA-1033). 영어 기기(Accept-Language 가 한국어가 아님)의 「예시 대본 고르기」는 language='en' 인 예시만 받고,
-- 한국어 기기는 지금처럼 language='ko'(기존 3편)만 받는다. 3편은 기존 rooftop·cafe·minji 를 뜻 그대로 영어로 옮긴 것이다.
-- raw_text 는 앱 내장 목록(apps/mobile/lib/reading/sample.ts 의 *_EN)과 글자 그대로 같다 — 같은 글 판정이 해시로 된다.
-- 미리 만든 상대역 음성(audio)은 아직 없다(NULL, 앱은 예전처럼 기기 목소리로 읽는다). 독백(mia-en)은 상대역이 없어 빈 음성이다.
-- 더하기만 하는 변경이다: 기본값이 있는 칸 하나와 새 줄 셋. 옛 서버는 language 칸을 몰라 영어 예시도 목록에 함께 보인다.
ALTER TABLE public.reading_examples ADD COLUMN language text DEFAULT 'ko' NOT NULL;

INSERT INTO public.reading_examples(id,title,summary,sort_order,active,language,raw_text,draft,audio) VALUES (
    'rooftop-en', 'Rooftop, night', 'Ellie · Theo · 2-person scene', 1, true, 'en',
    $raw$Rooftop, night

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
Ellie: Come on. It's cold.$raw$,
    $draft$
    {"characters": ["Ellie", "Theo"], "lines": [
      {"kind": "direction", "character": null, "text": "(Rooftop railing. City lights. Wind.)"},
      {"kind": "dialogue", "character": 0, "text": "Knew I'd find you up here."},
      {"kind": "dialogue", "character": 1, "text": "How'd you know?"},
      {"kind": "dialogue", "character": 0, "text": "You always go somewhere high when things get bad."},
      {"kind": "dialogue", "character": 1, "text": "(smiles) Do I?"},
      {"kind": "dialogue", "character": 0, "text": "Why didn't you tell me? About the audition."},
      {"kind": "dialogue", "character": 1, "text": "What would telling you change?"},
      {"kind": "dialogue", "character": 0, "text": "Everything. I know how hard you worked for that one."},
      {"kind": "dialogue", "character": 1, "text": "That's exactly why I didn't want to tell you."},
      {"kind": "direction", "character": null, "text": "(Beat. Theo leans on the railing.)"},
      {"kind": "dialogue", "character": 0, "text": "When's the next one?"},
      {"kind": "dialogue", "character": 1, "text": "Day after tomorrow."},
      {"kind": "dialogue", "character": 0, "text": "Then let's go down. I'll read the other part for you."},
      {"kind": "dialogue", "character": 1, "text": "You can't act."},
      {"kind": "dialogue", "character": 0, "text": "I know. Still better than doing it alone."},
      {"kind": "dialogue", "character": 1, "text": "(looks at her for a while) Thanks."},
      {"kind": "dialogue", "character": 0, "text": "Come on. It's cold."}
    ]}$draft$::jsonb,
    NULL);

INSERT INTO public.reading_examples(id,title,summary,sort_order,active,language,raw_text,draft,audio) VALUES (
    'cafe-en', 'Café, the breakup talk', 'Hannah · Josh · 2-person scene', 2, true, 'en',
    $raw$Café, the breakup talk

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
Hannah: Take care.$raw$,
    $draft$
    {"characters": ["Hannah", "Josh"], "lines": [
      {"kind": "direction", "character": null, "text": "(A window seat. Two cups of coffee gone cold.)"},
      {"kind": "dialogue", "character": 0, "text": "You're early."},
      {"kind": "dialogue", "character": 1, "text": "Yeah, a little. Sit down."},
      {"kind": "dialogue", "character": 0, "text": "You said you had something to tell me. Your text sounded off."},
      {"kind": "dialogue", "character": 1, "text": "Yeah. I've been thinking about it for a long time."},
      {"kind": "dialogue", "character": 0, "text": "And?"},
      {"kind": "dialogue", "character": 1, "text": "I think we should stop. Us, I mean."},
      {"kind": "dialogue", "character": 0, "text": "(silent for a moment) So this isn't sudden."},
      {"kind": "dialogue", "character": 1, "text": "No. It's been a few months for me."},
      {"kind": "dialogue", "character": 0, "text": "I had no idea. That's the part that hurts most."},
      {"kind": "dialogue", "character": 1, "text": "I kept meaning to say it. The timing was never right."},
      {"kind": "dialogue", "character": 0, "text": "Don't blame the timing."},
      {"kind": "dialogue", "character": 1, "text": "Sorry. That was cowardly of me."},
      {"kind": "direction", "character": null, "text": "(Beat. Hannah turns her cup in her hands.)"},
      {"kind": "dialogue", "character": 0, "text": "Okay. But today, I'm the one who leaves first."},
      {"kind": "dialogue", "character": 1, "text": "Okay."},
      {"kind": "dialogue", "character": 0, "text": "Take care."}
    ]}$draft$::jsonb,
    NULL);

INSERT INTO public.reading_examples(id,title,summary,sort_order,active,language,raw_text,draft,audio) VALUES (
    'mia-en', 'Mia''s monologue', 'Solo monologue', 3, true, 'en',
    $raw$Mia's monologue

(On the way home from work. Forehead against the bus window.)

I told everyone I was fine again today. I'm not sure I actually was. Mom called, and I let it ring. I knew if I heard her voice, I'd cry. When I get home, I'll turn the lights on first. Drink a glass of water. Then I'm going to let myself believe it'll get a little better.$raw$,
    $draft$
    {"characters": ["Mia"], "lines": [
      {"kind": "direction", "character": null, "text": "(On the way home from work. Forehead against the bus window.)"},
      {"kind": "dialogue", "character": 0, "text": "I told everyone I was fine again today."},
      {"kind": "dialogue", "character": 0, "text": "I'm not sure I actually was."},
      {"kind": "dialogue", "character": 0, "text": "Mom called, and I let it ring."},
      {"kind": "dialogue", "character": 0, "text": "I knew if I heard her voice, I'd cry."},
      {"kind": "dialogue", "character": 0, "text": "When I get home, I'll turn the lights on first."},
      {"kind": "dialogue", "character": 0, "text": "Drink a glass of water."},
      {"kind": "dialogue", "character": 0, "text": "Then I'm going to let myself believe it'll get a little better."}
    ]}$draft$::jsonb,
    $audio$
    {"voices": {}, "lines": []}$audio$::jsonb);
