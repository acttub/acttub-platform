-- 입시 준비 배우 첫 화면(SOMA-864, 서버 부분).
-- 1) 예시 대본 분류: reading_examples.category — 'general'(기존) | 'exam'(입시 대사). GET /v2/reading/examples 가 항목마다 싣는다.
-- 2) 실기 날짜: user_profiles.exam_date(date, 없을 수 있음). PUT /v2/me/exam-date 로만 바꾼다(프로필 저장은 건드리지 않는다).
-- 3) 입시 예시 3개. 규칙은 V61 과 같다: raw_text 는 글자 그대로, draft 는 {"characters": [...], "lines": [{kind, character, text}]}.
--    독백은 characters 한 명이고 모든 대사 character 0, 괄호 지문 줄은 kind direction(character null). 앱 내장 목록에는 넣지 않는다.
-- 더하기만 하는 변경이다: 열 둘을 더하고(기본값·NULL 허용) 행 셋을 넣는다. 옛 서버는 새 열을 모르고도 그대로 돈다.
ALTER TABLE public.reading_examples ADD COLUMN category text DEFAULT 'general' NOT NULL;
ALTER TABLE public.user_profiles ADD COLUMN exam_date date;

INSERT INTO public.reading_examples(id,title,summary,sort_order,active,category,raw_text,draft) VALUES (
    'exam-result', '발표 한 시간 전', '지민 · 독백 · 입시',
    (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM public.reading_examples), true, 'exam',
    $raw$발표 한 시간 전

(방 안. 휴대폰을 엎어 놓은 채 앉아 있다.)

지민: 엄마, 나 아직 안 봤어. 발표 한 시간 전에 떴대.
지민: 근데 못 누르겠어. 누르면 끝나잖아. 붙었든 떨어졌든, 오늘부터는 진짜가 되잖아.
지민: 작년에는 바로 눌렀어. 떨어졌다는 글자 보고, 아무렇지 않은 척 밥 먹었어. 엄마도 아무 말 안 했고.
지민: 그게 더 힘들었어. 차라리 울었으면 좋았을 텐데.
지민: 그래서 이번엔 엄마 옆에서 보려고. 떨어지면, 이번엔 울게. 진짜로.

(휴대폰을 든다. 숨을 고른다.)

지민: 하나, 둘…… 아니, 엄마가 눌러 줘.$raw$,
    $draft$
    {"characters": ["지민"], "lines": [
      {"kind": "direction", "character": null, "text": "(방 안. 휴대폰을 엎어 놓은 채 앉아 있다.)"},
      {"kind": "dialogue", "character": 0, "text": "엄마, 나 아직 안 봤어. 발표 한 시간 전에 떴대."},
      {"kind": "dialogue", "character": 0, "text": "근데 못 누르겠어. 누르면 끝나잖아. 붙었든 떨어졌든, 오늘부터는 진짜가 되잖아."},
      {"kind": "dialogue", "character": 0, "text": "작년에는 바로 눌렀어. 떨어졌다는 글자 보고, 아무렇지 않은 척 밥 먹었어. 엄마도 아무 말 안 했고."},
      {"kind": "dialogue", "character": 0, "text": "그게 더 힘들었어. 차라리 울었으면 좋았을 텐데."},
      {"kind": "dialogue", "character": 0, "text": "그래서 이번엔 엄마 옆에서 보려고. 떨어지면, 이번엔 울게. 진짜로."},
      {"kind": "direction", "character": null, "text": "(휴대폰을 든다. 숨을 고른다.)"},
      {"kind": "dialogue", "character": 0, "text": "하나, 둘…… 아니, 엄마가 눌러 줘."}
    ]}$draft$::jsonb);

INSERT INTO public.reading_examples(id,title,summary,sort_order,active,category,raw_text,draft) VALUES (
    'exam-brother', '형에게', '도윤 · 독백 · 입시',
    (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM public.reading_examples), true, 'exam',
    $raw$형에게

(버스 정류장. 휴대폰에 대고 음성 메시지를 남긴다.)

도윤: 형, 나야. 받지 마. 그냥 들어.
도윤: 형 나간 지 오늘로 일 년이야. 엄마는 형 방 그대로 둬. 이불도 안 개고.
도윤: 나 처음엔 형이 미웠어. 말도 없이 가 버려서. 나한테까지 말 안 한 게 제일 미웠어.
도윤: 근데 요즘은 좀 알 것 같아. 그 집에서 숨 쉬는 게 얼마나 어려웠는지.
도윤: 나 요즘 연기 배워. 형이 하던 거. 웃기지. 형 대본 몰래 읽다가 시작했어.
도윤: 다음 주에 시험 봐. 붙으면, 그때는 형한테 전화할게. 그땐 받아.

(버스가 들어온다.)

도윤: 끊는다.$raw$,
    $draft$
    {"characters": ["도윤"], "lines": [
      {"kind": "direction", "character": null, "text": "(버스 정류장. 휴대폰에 대고 음성 메시지를 남긴다.)"},
      {"kind": "dialogue", "character": 0, "text": "형, 나야. 받지 마. 그냥 들어."},
      {"kind": "dialogue", "character": 0, "text": "형 나간 지 오늘로 일 년이야. 엄마는 형 방 그대로 둬. 이불도 안 개고."},
      {"kind": "dialogue", "character": 0, "text": "나 처음엔 형이 미웠어. 말도 없이 가 버려서. 나한테까지 말 안 한 게 제일 미웠어."},
      {"kind": "dialogue", "character": 0, "text": "근데 요즘은 좀 알 것 같아. 그 집에서 숨 쉬는 게 얼마나 어려웠는지."},
      {"kind": "dialogue", "character": 0, "text": "나 요즘 연기 배워. 형이 하던 거. 웃기지. 형 대본 몰래 읽다가 시작했어."},
      {"kind": "dialogue", "character": 0, "text": "다음 주에 시험 봐. 붙으면, 그때는 형한테 전화할게. 그땐 받아."},
      {"kind": "direction", "character": null, "text": "(버스가 들어온다.)"},
      {"kind": "dialogue", "character": 0, "text": "끊는다."}
    ]}$draft$::jsonb);

INSERT INTO public.reading_examples(id,title,summary,sort_order,active,category,raw_text,draft) VALUES (
    'exam-studio', '새벽 연습실', '서연 · 지호 · 2인 지정대사',
    (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM public.reading_examples), true, 'exam',
    $raw$새벽 연습실

(불 꺼진 연습실. 서연이 혼자 대사를 하다 멈춘다.)

지호: 아직 안 갔어?
서연: 한 번만 더 하고 가려고.
지호: 그 대사 오늘만 백 번은 했겠다.
서연: 할 때마다 다르게 나와. 그게 무서워.
지호: 다르게 나오는 게 왜 무서워.
서연: 시험장에서 어떤 게 나올지 모르잖아.
지호: 그럼 오늘 나온 것 중에 제일 좋았던 거 하나만 기억해.
서연: 제일 좋았던 거?
지호: 아까 세 번째. 끝에 숨 한 번 쉬고 말한 거.
서연: (잠시) 그거 봤어?
지호: 처음부터 다 봤어. 이제 가자. 내일 또 하면 되잖아.$raw$,
    $draft$
    {"characters": ["서연", "지호"], "lines": [
      {"kind": "direction", "character": null, "text": "(불 꺼진 연습실. 서연이 혼자 대사를 하다 멈춘다.)"},
      {"kind": "dialogue", "character": 1, "text": "아직 안 갔어?"},
      {"kind": "dialogue", "character": 0, "text": "한 번만 더 하고 가려고."},
      {"kind": "dialogue", "character": 1, "text": "그 대사 오늘만 백 번은 했겠다."},
      {"kind": "dialogue", "character": 0, "text": "할 때마다 다르게 나와. 그게 무서워."},
      {"kind": "dialogue", "character": 1, "text": "다르게 나오는 게 왜 무서워."},
      {"kind": "dialogue", "character": 0, "text": "시험장에서 어떤 게 나올지 모르잖아."},
      {"kind": "dialogue", "character": 1, "text": "그럼 오늘 나온 것 중에 제일 좋았던 거 하나만 기억해."},
      {"kind": "dialogue", "character": 0, "text": "제일 좋았던 거?"},
      {"kind": "dialogue", "character": 1, "text": "아까 세 번째. 끝에 숨 한 번 쉬고 말한 거."},
      {"kind": "dialogue", "character": 0, "text": "(잠시) 그거 봤어?"},
      {"kind": "dialogue", "character": 1, "text": "처음부터 다 봤어. 이제 가자. 내일 또 하면 되잖아."}
    ]}$draft$::jsonb);
