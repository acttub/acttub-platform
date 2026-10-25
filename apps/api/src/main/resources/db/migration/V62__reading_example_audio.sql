-- 예시 대본의 미리 만든 상대역 음성(reading.script 「예시 대본」). 앱은 예시를 복사한 대본이면 GET /v2/reading/scripts/{id}/example-audio
-- 로 이 음성의 임시 주소를 받아 틀고, 190MB 기기 목소리 모델을 받지 않는다.
--
-- audio 는 {"prefix": 영상 버킷 안의 자리(끝 /), "voices": {배역 이름: 프리셋}, "lines": [{"seq": draft 줄 자리(1부터, 지문 포함),
-- "key": prefix 뒤 파일 이름, "duration_ms": 길이}…]} 이다. 파일은 대사 줄마다 하나이고 그 배역의 목소리(voices)로 만들었다 —
-- 갓 복사한 대본의 자동 목소리(F1·M1 순환)와 같다. lines 가 비면(minji, 독백) 상대역이 없어 음성도 모델도 필요 없다는 뜻이다.
-- NULL 이면 미리 만든 음성이 없다(앱은 예전처럼 모델로 읽는다).
-- 파일은 dev·운영 버킷(acttub-practice-videos-dev·-prod)의 reading-examples/v1/<id>/<seq>.m4a 에 미리 올려 두었다(AAC 모노 96kbps,
-- 앱과 같은 Supertonic 3 fp16·단계 8·속도 1.0·세기 맞추기). 다시 만들면 판(v2/)을 새로 두고 이 칸을 고친다.
-- 더하기만 하는 변경이다: 비어도 되는 칸 하나. 옛 서버는 이 칸을 모른다.
ALTER TABLE public.reading_examples ADD COLUMN audio jsonb;

UPDATE public.reading_examples SET audio = $audio$
    {"prefix": "reading-examples/v1/rooftop/", "voices": {"윤서": "F1", "태오": "M1"}, "lines": [{"seq": 2, "key": "2.m4a", "duration_ms": 2020}, {"seq": 3, "key": "3.m4a", "duration_ms": 1672}, {"seq": 4, "key": "4.m4a", "duration_ms": 3065}, {"seq": 5, "key": "5.m4a", "duration_ms": 1393}, {"seq": 6, "key": "6.m4a", "duration_ms": 3413}, {"seq": 7, "key": "7.m4a", "duration_ms": 2020}, {"seq": 8, "key": "8.m4a", "duration_ms": 5085}, {"seq": 9, "key": "9.m4a", "duration_ms": 4110}, {"seq": 11, "key": "11.m4a", "duration_ms": 1672}, {"seq": 12, "key": "12.m4a", "duration_ms": 1393}, {"seq": 13, "key": "13.m4a", "duration_ms": 4667}, {"seq": 14, "key": "14.m4a", "duration_ms": 1881}, {"seq": 15, "key": "15.m4a", "duration_ms": 3761}, {"seq": 16, "key": "16.m4a", "duration_ms": 1393}, {"seq": 17, "key": "17.m4a", "duration_ms": 1741}]}$audio$::jsonb, updated_at = now() WHERE id = 'rooftop';

UPDATE public.reading_examples SET audio = $audio$
    {"prefix": "reading-examples/v1/cafe/", "voices": {"서연": "F1", "준호": "M1"}, "lines": [{"seq": 2, "key": "2.m4a", "duration_ms": 1532}, {"seq": 3, "key": "3.m4a", "duration_ms": 2229}, {"seq": 4, "key": "4.m4a", "duration_ms": 3831}, {"seq": 5, "key": "5.m4a", "duration_ms": 2438}, {"seq": 6, "key": "6.m4a", "duration_ms": 1393}, {"seq": 7, "key": "7.m4a", "duration_ms": 3343}, {"seq": 8, "key": "8.m4a", "duration_ms": 2368}, {"seq": 9, "key": "9.m4a", "duration_ms": 3552}, {"seq": 10, "key": "10.m4a", "duration_ms": 3343}, {"seq": 11, "key": "11.m4a", "duration_ms": 3343}, {"seq": 12, "key": "12.m4a", "duration_ms": 2020}, {"seq": 13, "key": "13.m4a", "duration_ms": 2925}, {"seq": 15, "key": "15.m4a", "duration_ms": 4040}, {"seq": 16, "key": "16.m4a", "duration_ms": 1393}, {"seq": 17, "key": "17.m4a", "duration_ms": 1393}]}$audio$::jsonb, updated_at = now() WHERE id = 'cafe';

UPDATE public.reading_examples SET audio = $audio$
    {"voices": {}, "lines": []}$audio$::jsonb, updated_at = now() WHERE id = 'minji';
