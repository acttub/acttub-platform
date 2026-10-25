-- 예시 대본(reading.script 「예시 대본」). 앱 「예시 대본 고르기」가 서버에서 목록을 받고, 고르면 미리 나눈 결과(draft)를
-- 그 사람의 대본으로 복사한다 — 모델·script_split 동의·하루 나누기 한도 없이 바로 된다. 대본 수 한도는 그대로 센다.
--
-- id 는 앱 내장 목록(apps/mobile/lib/reading/sample.ts)의 id 와 같다. raw_text 는 앱 글과 글자 그대로 같아야 한다 — 같은 글
-- (scripts.raw_hash)의 대본이 이미 있으면 새로 복사하지 않고 그 대본을 준다. rooftop 은 옛 앱이 글로 올리는 길
-- (SampleScript 해시 판별)과 같은 글·같은 나눔이다.
-- draft 는 {"characters": [배역 이름…], "lines": [{"kind": dialogue|direction|scene, "character": 배역 자리(0부터)|null,
-- "text": 줄 글}…]} 이다. 줄 순서가 ordinal(1부터)이다. 고치기·추가는 새 마이그레이션(또는 운영 SQL)으로 하고 앱 배포가 필요 없다.
-- active=false 면 목록에서 빠지고 복사도 404 다. 이미 복사한 대본은 그 사람의 것이라 그대로 남는다.
-- 더하기만 하는 변경이다: 새 표 하나이고 옛 표는 건드리지 않는다. 옛 서버는 이 표를 모른다.
CREATE TABLE public.reading_examples (
    id text NOT NULL PRIMARY KEY,
    title text NOT NULL,
    summary text NOT NULL,
    sort_order integer NOT NULL,
    active boolean DEFAULT true NOT NULL,
    raw_text text NOT NULL,
    draft jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

INSERT INTO public.reading_examples(id,title,summary,sort_order,active,raw_text,draft) VALUES (
    'rooftop', '옥상, 밤', '윤서 · 태오 · 2인 대화', 1, true,
    $raw$옥상, 밤

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
윤서: 가자. 춥다.$raw$,
    $draft$
    {"characters": ["윤서", "태오"], "lines": [
      {"kind": "direction", "character": null, "text": "(옥상 난간. 도시 불빛. 바람 소리.)"},
      {"kind": "dialogue", "character": 0, "text": "여기 있을 줄 알았어."},
      {"kind": "dialogue", "character": 1, "text": "어떻게 알았어."},
      {"kind": "dialogue", "character": 0, "text": "너 힘들면 항상 높은 데로 가잖아."},
      {"kind": "dialogue", "character": 1, "text": "(웃으며) 그런가."},
      {"kind": "dialogue", "character": 0, "text": "왜 말 안 했어. 오디션 떨어진 거."},
      {"kind": "dialogue", "character": 1, "text": "말하면 뭐가 달라져."},
      {"kind": "dialogue", "character": 0, "text": "달라지지. 나는 알잖아, 네가 그거 얼마나 준비했는지."},
      {"kind": "dialogue", "character": 1, "text": "그래서 더 말하기 싫었어. 네가 그걸 아니까."},
      {"kind": "direction", "character": null, "text": "(사이. 태오가 난간에 기댄다.)"},
      {"kind": "dialogue", "character": 0, "text": "다음 거 언제야."},
      {"kind": "dialogue", "character": 1, "text": "모레."},
      {"kind": "dialogue", "character": 0, "text": "그럼 오늘은 내려가자. 대본은 내가 상대역 해줄게."},
      {"kind": "dialogue", "character": 1, "text": "너 연기 못하잖아."},
      {"kind": "dialogue", "character": 0, "text": "알아. 그래도 혼자 하는 것보단 낫지."},
      {"kind": "dialogue", "character": 1, "text": "(한참 보다가) 고마워."},
      {"kind": "dialogue", "character": 0, "text": "가자. 춥다."}
    ]}$draft$::jsonb);

INSERT INTO public.reading_examples(id,title,summary,sort_order,active,raw_text,draft) VALUES (
    'cafe', '카페, 헤어지자는 말', '서연 · 준호 · 2인 대화', 2, true,
    $raw$카페, 헤어지자는 말

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
서연: 잘 지내.$raw$,
    $draft$
    {"characters": ["서연", "준호"], "lines": [
      {"kind": "direction", "character": null, "text": "(창가 자리. 식은 커피 두 잔.)"},
      {"kind": "dialogue", "character": 0, "text": "일찍 왔네."},
      {"kind": "dialogue", "character": 1, "text": "어, 조금. 앉아."},
      {"kind": "dialogue", "character": 0, "text": "할 말 있다며. 메시지가 좀 이상하더라."},
      {"kind": "dialogue", "character": 1, "text": "응. 오래 생각했어."},
      {"kind": "dialogue", "character": 0, "text": "그래서?"},
      {"kind": "dialogue", "character": 1, "text": "우리, 이제 그만하는 게 맞는 것 같아."},
      {"kind": "dialogue", "character": 0, "text": "(잠시 말이 없다가) 갑자기가 아니라는 말이지."},
      {"kind": "dialogue", "character": 1, "text": "갑자기는 아니야. 나도 몇 달 됐어."},
      {"kind": "dialogue", "character": 0, "text": "나는 몰랐어. 그게 제일 서운해."},
      {"kind": "dialogue", "character": 1, "text": "말하려고 했는데 매번 타이밍을 놓쳤어."},
      {"kind": "dialogue", "character": 0, "text": "타이밍 탓은 하지 마."},
      {"kind": "dialogue", "character": 1, "text": "미안. 그건 내가 비겁했어."},
      {"kind": "direction", "character": null, "text": "(사이. 서연이 컵을 만지작거린다.)"},
      {"kind": "dialogue", "character": 0, "text": "알겠어. 대신 오늘은 내가 먼저 일어날게."},
      {"kind": "dialogue", "character": 1, "text": "그래."},
      {"kind": "dialogue", "character": 0, "text": "잘 지내."}
    ]}$draft$::jsonb);

INSERT INTO public.reading_examples(id,title,summary,sort_order,active,raw_text,draft) VALUES (
    'minji', '민지의 독백', '혼자 읽는 독백', 3, true,
    $raw$민지의 독백

(퇴근길. 버스 창문에 이마를 기댄 채.)

오늘도 괜찮다고 말했다. 정말 괜찮았던 건지는 잘 모르겠다. 엄마한테 전화가 왔는데 일부러 받지 않았다. 목소리를 들으면 울 것 같아서였다. 집에 가면 불부터 켜야지. 물도 한 잔 마셔야지. 그러고 나면 조금은 나아질 거라고 믿어 보기로 했다.$raw$,
    $draft$
    {"characters": ["민지"], "lines": [
      {"kind": "direction", "character": null, "text": "(퇴근길. 버스 창문에 이마를 기댄 채.)"},
      {"kind": "dialogue", "character": 0, "text": "오늘도 괜찮다고 말했다."},
      {"kind": "dialogue", "character": 0, "text": "정말 괜찮았던 건지는 잘 모르겠다."},
      {"kind": "dialogue", "character": 0, "text": "엄마한테 전화가 왔는데 일부러 받지 않았다."},
      {"kind": "dialogue", "character": 0, "text": "목소리를 들으면 울 것 같아서였다."},
      {"kind": "dialogue", "character": 0, "text": "집에 가면 불부터 켜야지."},
      {"kind": "dialogue", "character": 0, "text": "물도 한 잔 마셔야지."},
      {"kind": "dialogue", "character": 0, "text": "그러고 나면 조금은 나아질 거라고 믿어 보기로 했다."}
    ]}$draft$::jsonb);

