# reading.voice-coaching — 리딩 녹음으로 코칭 받기 (SOMA-791)

> **스위치 `ACTTUB_READING_VOICE_COACHING_ENABLED=true` 인 배포에만 있다(값이 없으면 dev 만 켜짐, 운영은 꺼짐).** 리딩의 원칙 "연기를 평가하지 않는다,
> 서버는 음성을 분석하지 않는다"([README](README.md))의 예외다. 윤지환 멘토 제안(10/21 Webex, 10/27 2회차): 리딩을 마친
> 배우가 새로 찍지 않고 방금 녹음으로 코칭을 받고, 영상 코칭으로 이어 간다. 핵심 지표는 리딩만 한 배우와 리딩 뒤 이 코칭까지
> 받은 배우의 리텐션, 보조 지표는 이 코칭 → 영상 업로드 전환이다. 이 문서는 10/21 실험(두 차례 답하는 따로 된 코치,
> `/v2/recording-coaches`, V48 표)을 갈아엎은 것이다 — 그 경로·표는 없앴다(V68).

## 흐름
1. 리딩 완료 화면 카드 「방금 읽은 대본으로 코칭도 받아볼까요?」 — 소리 든 내 대사 녹음이 3줄 이상일 때만 뜬다.
2. 한 번 누르면 바로 시작한다. 목적은 고르지 않는다. 무료이고 무료 코칭 한도(하루 3회차)를 쓰지 않는다.
3. 코칭 대화(일반 코칭 화면). 짧게 시작해 조금씩 코칭으로 들어간다:
   - **hear 들린 것** — [서버가 잰 소리] 하나를 그 대사로 가리키고, 그 대사로 인물의 이유·바라는 것을 묻는다(버튼 셋).
   - **try 해 볼 것** — 배우 답을 그 대사와 잇고, 다시 읽을 때 상대에게 무엇을 하며 말할지 묻는다(버튼 셋).
   - **wrap 정리** — 정한 것 한 줄 + "그 한 줄을 영상으로 올리면 표정·시선까지 보고 더 깊게 코칭"을 권한다.
     `<다음 테이크>`는 `"대본 그 줄 그대로"에서 해 볼 것` 모양이다(앱이 따옴표 안을 찍을 대사로 쓴다).
   - 정리 뒤 배우가 물으면 정리를 다시 하지 않고 답한다(말로 하는 코칭과 같다). 질문 상한·응답 상한은 목적별 코칭과 같다.
4. 「영상 올리고 더 깊게 코칭 받기」 — 그 회차를 닫고 같은 묶음의 이어하기(`POST /v2/practices/{id}/continue`)로 영상을 올린다.
   이은 회차는 평가 받기(evaluate) 목적의 영상 코칭이고, 앞 대화는 지난 맥락으로 받는다.

## 입력·출력
| 경로 | 응답 |
|---|---|
| `GET /v2/reading/sessions/{session_id}/voice-coaching` | 200 `{available, practice_id}` · 남의·없는 회차 404 `session_not_found` · 스위치 꺼짐 404 |
| `POST /v2/practices` `{request_id, reading_session_id}` | 201 회차(`video_id` null, `session_purpose` reading, `stage` conversing) |

- 시작 요청은 `video_id`·`session_purpose` 를 같이 보내면 422(배열)다. 소리 든 내 대사 녹음 3줄 미만은 422
  `reading_voice_not_enough_audio`, 남의·없는 리딩 회차·스위치 꺼짐은 404 `session_not_found` 다.
- 리딩 회차 하나에 이 코칭은 하나다(`practices.reading_session_id` 부분 유일 인덱스). 이미 있으면 다른 요청 id 로 불러도 그 회차다.
- 코칭 회차 응답과 대화 응답의 `purpose.purpose` 는 `reading`, `step` 은 hear·try·wrap 이다.

## 규칙·제약
- 소리 든 녹음: 받아쓴 글(stt)이 비지 않았거나, 받아쓰기가 없으면 0.8초보다 길다. 같은 줄은 마지막 시도만, 내 배역의 대사 줄만,
  대본 순서대로 20줄·15MB 까지(`ReadingVoiceMaterial`).
- 코치는 영상 대신 그 녹음들을 16kHz 모노 WAV 하나로 이어(줄마다 뒤에 0.6초 빈 소리) 모델에 올린다(`AudioJoiner`). 같은 녹음이면
  올려 둔 파일을 다시 쓴다(코치 영상 캐시와 같은 열쇠 방식). 대본(내 대사·상대 대사·지문), 줄별 시간, 서버가 잰 소리 단서를
  글로 함께 준다. 소리 단서는 발음 채점 서비스의 `/measure` 가 있을 때만 있고, 없으면 "확실히 다르게 잰 소리가 없다"다.
- 프롬프트: `coaching/direct-video/purpose/reading/` (`mode`·`first`·`path`·`try`·`wrap`). 소리는 잰 단서에 있는 것만 말하고,
  표정·몸 같은 신체 원인, 발음 교정·평가를 하지 않는다. 대본·배우 말에 없는 따옴표 대사는 서버가 뗀다. 결과 장담 문장도 뗀다.
- 연기 아님 끊기·너무 짧은 영상 검사·소리 없는 영상 검사는 하지 않는다. 녹음이 사라졌으면(리딩 회차 삭제) 그 답은 실패다.
- 코치 AI 없이 닫는 마무리 문장: 「오늘은 여기까지 해요. 그 한 줄을 영상으로 올리면 이어서 더 깊게 볼게요.」
- 일지·노트 입력의 `input_mode` 는 `reading_voice` 다.

## 검증
`ReadingVoiceCoachingIT`(카드·시작·재료, 실제 Postgres), `DirectVideoCoachReadingTest`(턴: 소리 올리기·프롬프트·단계·따옴표·마무리),
`PurposeLoopTest.readingStartsShortAndMovesToTryThenWrap`, `ReadingVoiceMaterialTest`, `AudioJoinerTest`,
`PracticeCreateRequestValidationTest`. 소리 관찰이 실제 녹음과 맞는지는 사람이 들어 확인한다(자동 검증 없음).
