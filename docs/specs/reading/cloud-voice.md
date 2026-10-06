# reading.cloud-voice 고품질 목소리

[공통 규칙](../common.md) · [영역 개요](README.md)

- 도입: 0.1.2
- 결정 기록: ADR-033
- 화면: 설정 「대본 리딩」 구역, 출시 기념 팝업(홈), 리딩 실행
- 테이블: reading_voice_cache, reading_voice_usage

## 기능
배우가 「고품질 목소리」를 켜면 상대 대사를 서버가 Google Gemini TTS로 만든 음성으로 읽는다. 켜지 않으면
지금처럼 기기 음성([reading.cast](cast.md))으로 읽는다. 출시 기념으로 무료 기간(2026-11-30까지) 동안 모두에게 열고,
앱을 켤 때 하루 한 번 알리는 팝업을 띄운다.

## 의도
기기 음성은 무료·오프라인이지만 억양이 단조롭다. 상대역이 사람처럼 읽으면 리딩이 실제 맞춰 보기에 가까워진다.
다만 대사가 외부로 나가므로 기본값으로 두지 않고, 켜는 사람에게만 따로 동의를 받는다.

## 목적
켠 배우는 상대 대사를 더 자연스러운 목소리로 듣고, 켜지 않은 배우의 흐름과 데이터는 바뀌지 않는다.

## 입력·출력
| 입구 | 입력 | 출력 | 오류 |
|---|---|---|---|
| `GET /v2/reading/voice/status` | 헤더 `Authorization`(회원) | `StatusResponse` 200: 지금 쓸 수 있는지(`available`), 무료 종료 시각, cloud_voice 현재 판에 대한 결정(granted·denied·undecided — 거절·철회는 denied), 오늘 한도와 쓴 양 | 게스트 `member_only` 403 |
| `POST /v2/reading/voice` | 헤더 `Authorization`(회원), `SynthesizeRequest`: `text`(앞뒤 공백을 걷은 1~500자), `voice`(M1~M5·F1~F5) | `SynthesizeResponse` 200: WAV(24kHz, 16-bit, mono) 재생 주소(600초), 캐시 적중 여부 | `invalid_voice_request` 400, `cloud_voice_consent_required` 403, `cloud_voice_daily_limit` 429, `cloud_voice_unavailable` 503, 게스트 `member_only` 403 |

## 상태
없음. 캐시는 문장마다 한 번 만들고 사용량은 회원·한국 날짜마다 센 줄 수다.

## 규칙·제약
- 켜려면 선택 동의 `cloud_voice`(대본 리딩 고품질 목소리)가 granted여야 한다. 동의는 켜는 순간 시트로 받고
  설정의 동의 목록에서 언제든 거둔다. 거두면 서버가 403 cloud_voice_consent_required를 주고 앱은 기기 음성으로 읽는다.
  이 동의는 가입·게이트에서 묻지 않는다([account.consent](../account/consent.md#데이터)).
- 보내는 것은 대사 문장과 목소리 프리셋뿐이다. 서버가 Gemini에 보내는 것은 문장 원문 하나이며 연기 지시를 붙이지 않는다.
- 목소리는 reading.cast의 프리셋(M1~M5·F1~F5)을 Gemini 목소리에 1:1로 맞춘다.
- 서버는 같은 모델·목소리·문장의 음성을 캐시한다. 적중하면 새로 만들지 않고 세지 않으며, 하루 한도를 넘은 뒤에도 준다.
  캐시는 사용자와 연결하지 않는다.
- 사용자당 하루(한국 날짜) 새 합성 300줄, 서비스 전체 한 달 75,000줄. 넘으면 429 cloud_voice_daily_limit /
  503 cloud_voice_unavailable이고 앱은 그 회차의 남은 줄을 기기 음성으로 읽는다.
- 무료 기간이 끝나면 status.available=false가 되어 설정 구역과 팝업이 사라지고 모두 기기 음성으로 돌아간다.
- 고품질 목소리를 쓸 수 있으면 기기 음성 모델(380MB) 내려받기를 묻지 않고 시작한다. 이때 서버 음성을 못 받은 줄은
  글로 보여 준다.
- 팝업: 홈에 들어올 때, 로그인 상태, 쓸 수 있고 아직 켜지 않았을 때, 하루(한국 날짜) 한 번. 「다시 보지 않기」를
  누르면 다시 띄우지 않는다. 첫 실행 온보딩 직후와 다른 시트가 떠 있을 때는 띄우지 않는다. 「들어보기」는 앱에
  들어 있는 샘플 한 줄을 튼다(서버 호출 없음).
- 탈퇴하면 그 회원의 사용량 행을 바로 지운다. 게스트는 쓸 수 없어 이관할 것이 없다.

## 예외
- 네트워크 실패·5xx·다운로드 실패: 그 줄만 기기 음성으로 만든다(모델이 없으면 글로 보기).
- 동의 시트에서 거절: 설정은 꺼진 채 남는다.
- text가 비었거나 500자 초과, 모르는 voice: 400 invalid_voice_request.
- TTS 모델 설정(GEMINI_TTS_MODEL)이 비어 있으면 status.available=false.
- 설정 없음·무료 기간 종료·월 상한·Gemini 또는 저장소 실패: 모두 503 cloud_voice_unavailable이다.

## 검증 방법
- 동의 없이 POST /v2/reading/voice: 403 cloud_voice_consent_required.
- 같은 문장을 두 번 요청: 두 번째는 cached=true이고 reading_voice_usage가 늘지 않는다.
- 하루 300줄을 새로 만든 뒤 새 문장: 429. 이미 만든 문장: 200.
- READING_VOICE_FREE_UNTIL을 과거로: status.available=false, POST 503, 앱 설정 구역·팝업이 보이지 않는다.
- 앱에서 켜고 리딩: 상대 대사가 서버 음성으로 나오고, 비행기 모드로 바꾸면 다음 줄부터 기기 음성으로 이어진다.
- 팝업: 같은 날 두 번째 실행에는 뜨지 않는다. 「다시 보지 않기」 뒤에는 다음 날에도 뜨지 않는다. 켠 뒤에는 뜨지 않는다.

## 범위 밖
- 웹 리딩. (ADR-033)
- 무료 기간 뒤의 유료화. iOS 인앱 결제가 필요하고 별도 결정이다. (ADR-033)
