# acting-summary

연습 영상과 서브텍스트(상황·인물 설정·의도)를 Gemini로 분석해 구조화된
`SceneSummary`를 만드는 Python 패키지입니다. 별도 HTTP 서비스로 배포하지 않고,
`acting-api`의 백그라운드 분석 워커가 프로세스 안에서 직접 호출합니다.

## 분석 흐름

1. 클라이언트가 `acting-api`에서 영상 업로드를 완료하고 연습 세션을 생성합니다.
2. 분석 워커가 영상을 내려받아 필요하면 압축한 뒤 `acting_summary.summarizer`를 호출합니다.
3. 결과는 세션에 저장되며, 세션 상세 API에서 분석 상태와 최신 요약을 조회합니다.

공개 API 사용법과 엔드포인트 계약은 [`../API.md`](../API.md)를 참고하세요.

## 입력과 출력

요약 엔진은 영상 파일 경로와 다음 `SubText` 값을 입력으로 받습니다.

- `situation`: 장면의 상황
- `character`: 인물 설정
- `subtext`: 장면에서 전달하려는 의도

`SceneSummary`는 다음 필드로 구성됩니다.

- `observation`: `timeline`, `dialogue`, `tempo`, `pitch`, `movement`,
  `expression`, `emotion`, `extra`로 나눈 시간순 관찰
- `summary`: 서브텍스트 대비 압축 요약
- `intent_alignment`: 의도와 실제 연기의 정렬·이탈
- `key_moment`: 가장 중요한 시간 구간과 그 이유
- `key_dimension`: 가장 중요한 연기 축과 그 이유
- `anomalies[]`: `start`/`end` 구간, 연기 축, 관찰 내용과 원인·영향,
  우선순위 근거를 담은 이상 징후 목록

`summary_id`는 `SceneSummary` 자체 필드가 아니라, `acting-api`가 저장한 요약을
세션 상세 응답에 포함할 때 덧붙이는 식별자입니다.

## 설정과 실행

일반 실행 진입점은 `acting-api`입니다. `GEMINI_API_KEY`와 선택 항목인
`GEMINI_MODEL`(기본값 `gemini-2.5-flash`)은
`apps/api/acting-api/.env`에 설정합니다. 게이트웨이가 이 파일을 먼저 읽은 뒤
같은 프로세스에서 요약 설정을 로드합니다. 패키지를 직접 호출할 때는 같은 변수를
셸 환경에 설정하거나 `load_settings(env_path=...)`에 환경 파일 경로를 전달하세요.

```bash
cd apps/api
uv run uvicorn acting_api.app:create_app --factory --host 127.0.0.1 --port 8000
```

게이트웨이의 다른 필수 설정은 [`../README.md`](../README.md)를 참고하세요.

## 테스트

```bash
cd apps/api

# 외부 API를 호출하지 않는 테스트
uv run --frozen --package acting-summary pytest acting-summary/tests -m "not gemini" -q

# 실제 Gemini 호출 (비용 발생 가능)
GEMINI_API_KEY=... SAMPLE_VIDEO=/absolute/path/video.mp4 \
  uv run --frozen --package acting-summary pytest \
  acting-summary/tests/test_integration_gemini.py -m gemini -q
```
