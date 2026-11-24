# app.config 앱 설정

[공통 규칙](../common.md) · [영역 개요](README.md)

- 도입: SOMA-939 (리딩 말풍선 줄 수는 회차 응답 `chunk_lines`, SOMA-938)
- 경로: `GET /v2/app/config` — 인증 없음(가입 화면에서도 쓴다). 사람마다 다르지 않은 운영 값뿐이다.
- 저장: 표 없음. 서버 파일이다.

## 기능
운영 중에 바꿀 일이 있는 앱의 숫자·문구를 서버가 내려준다. 바꿀 때 앱을 다시 출시하지 않는다.

| 칸 | 뜻 |
|---|---|
| `rating.coach_every` · `reading_every` | 코칭·리딩을 몇 번 마칠 때마다 앱 평가를 묻는가 |
| `rating.min_gap_days` · `max_asks` | 묻는 최소 간격(일)·최대 횟수 |
| `reading.vad_threshold` · `silence_ms` · `min_speech_ms` · `max_listen_ms` | 리딩 침묵 감지(소리 크기 기준, 침묵 길이, 최소 말 길이, 최대 듣기) |
| `reading.speech_end_grace_ms` | 인식기가 말 끝을 알린 뒤 넘기기 전에 더 기다리는 시간 |
| `reading.advance_coverage` | 대사를 이 비율 이상 말해야 침묵을 줄 끝으로 친다 |
| `reading.monologue_pass` | 독백 문장을 맞게 읽었다고 보는 선 — **서버 판정(LineMatch)과 같은 값, 파일로 못 바꾼다** |
| `reading.monologue_missed_below` · `monologue_next_at` · `monologue_touch_min` | 독백 빠뜨림 판정·다음 문장으로 강조를 옮기는 비율·읽기 시작으로 보는 글자 수 |
| `cocreate.emotions` | 대본 같이 만들기 감정 칩(보이는 순서). **서버가 받는 감정 목록 밖의 값은 뺀다** |
| `cocreate.situations` | 같이 만들기 상황 칩(자유 글) |
| `cocreate_en.emotions` · `cocreate_en.situations` | 한국어가 아닌 기기(Accept-Language)에 `cocreate` 자리로 내려 주는 영어 칩(SOMA-1033). 감정은 서버가 받는 영어 목록 밖의 값을 뺀다 |
| `home_tips.ko` · `home_tips.en` | 서버는 내려주지만 읽는 앱 코드가 없다(SOMA-1104에서 지웠다) |
| `challenge.entry_min_seconds` | 챌린지 참여 영상 최소 길이(초) |
| `challenge.entry_max_seconds` · `durations_days` | 참여 영상 최대 길이·챌린지 기간 — **서버 규칙(ChallengeRules)과 같은 값, 파일로 못 바꾼다** |

정본은 둘이다. 파일로 덮을 수 있는 칸의 기본값은 서버 `apps/api/src/main/resources/app-config/defaults.json`이고, 파일로 못 바꾸는
`reading.monologue_pass`·`challenge.entry_max_seconds`·`challenge.durations_days`는 그 파일에 없이
`apps/api/src/main/java/com/acttub/actingapi/feature/appconfig/adapter/AppConfigConfiguration.java`의 `RULES`가 정한다.

## 운영 — 값 바꾸기
1. 서버에 JSON 파일을 둔다(예: `/svc/acttub/<env>/app-config.json`). 바꿀 칸만 적으면 된다 — 나머지는 기본값이다.
   ```json
   { "rating": { "coach_every": 3 }, "reading": { "silence_ms": 2000 } }
   ```
2. api 의 `APP_CONFIG_FILE` 에 그 경로를 넣고(컨테이너 안 경로로 마운트) api 를 다시 띄운다. 기동할 때 한 번 읽는다.
3. 잘못 쓴 칸(음수, 0~1 밖 비율, 빈 목록, 서버가 받지 않는 감정)은 그 칸만 기본값으로 돌린다. 파일을 못 읽거나 JSON 이 깨졌으면
   통째로 기본값으로 서고 `app_config_override_ignored` 경고를 남긴다 — 설정 실수로 api 가 안 뜨지 않는다.
4. 덮을 수 있는 칸의 기본값은 `apps/api/src/main/resources/app-config/defaults.json` 이다.

## 앱
- 켤 때 기기에 남긴 마지막 설정을 먼저 쓰고, 서버에서 받으면 바꿔 끼우고 남긴다(`lib/app-config-load.ts`). 못 받으면 남긴 값, 그것도 없으면
  앱에 든 기본값(`lib/app-config.ts`)으로 돈다. 그 값은 서버 `defaults.json`과 서버 규칙(`AppConfigConfiguration.RULES`)의 값과
  같다. 앱이 읽지 않는 `home_tips`는 앱 기본값에 없다.
- 칸마다 다시 검사해, 빠지거나 이상한 칸은 그 칸만 앱 기본값을 쓴다.
- 이미 떠 있는 화면은 다시 그릴 때 새 값을 쓴다 — 켜자마자 받은 값은 대개 다음 화면부터 반영된다.
