# acting-summary

연습 영상과 배우 재료(상황·캐릭터·이번 테이크의 목적)를 Gemini로 확인해
`ObservationPack`을 만드는 Python 패키지입니다. 별도 HTTP 서비스로 배포하지 않고,
`acting-api`의 백그라운드 분석 워커가 프로세스 안에서 직접 호출합니다.

## 분석 흐름

1. 클라이언트가 `acting-api`에서 영상 업로드를 완료하고 연습 세션을 생성합니다.
2. 분석 워커가 영상을 내려받아 필요하면 압축한 뒤 `acting_summary.summarizer`를 호출합니다.
3. 결과는 세션에 저장되며, 세션 상세 API에서 분석 상태와 최신 요약을 조회합니다.

공개 API 사용법과 엔드포인트 계약은 [`../API.md`](../API.md)를 참고하세요.

## 입력과 출력

관찰 엔진은 영상 파일 경로와 다음 `ActorMaterial` 값을 입력으로 받습니다.

- `situation`: 장면의 상황
- `character`: 인물 설정
- `goal`: 이번 테이크의 목적
- `blockage_kind`, `blockage_detail`: 배우가 고른 막힘과 상세
- `duration_ms`: 영상 길이

`ObservationPack`은 다음 필드로 구성됩니다.

- `observations[]`: `start_ms`, `end_ms`, `label`, `confidence`로 된 확인 가능한 사실. 0개가 정상이고 최대 3개입니다.
- `uncertainties[]`: 영상에서 확인할 수 없었던 것

`summary_id`는 `ObservationPack` 자체 필드가 아니라, `acting-api`가 저장한 결과를
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
