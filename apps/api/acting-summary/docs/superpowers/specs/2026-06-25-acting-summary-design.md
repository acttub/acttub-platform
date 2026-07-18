# 설계: 영상 → 서브텍스트 정렬 요약 (acting-summary)

> 작성: 2026-06-25
> 한 줄: **유저가 영상 + 서브텍스트(상황·인물설정·서브텍스트)를 보내면, Gemini가 영상을 직접 보고 "다음 단계 챗 LLM이 쓰기 좋은" 통합 요약 1개(JSON)를 만들어 돌려준다.**

## 목적 / 맥락

- 다음 단계: 별도의 챗 LLM이 이 요약을 받아 유저와 대화하며 **"제일 큰 문제 하나를 짚고 → 여긴 왜 그랬어?"** 식으로 코칭한다.
- 따라서 요약은 **원본 손실 최소** · **서브텍스트 대비 정렬** · **불필요한 건 생략하되 이상한 부분은 절대 생략 금지**.
- "이상한 부분 보존"이 핵심: 다음 LLM이 짚을 "제일 큰 문제"의 후보가 바로 그 이상 지점들이다. 요약이 그걸 죽이면 파이프라인이 망가진다.

## 아키텍처 (Approach C — 한 방 호출, 이중 필드)

```
client ──POST /summarize (영상파일 + 상황 + 인물설정 + 서브텍스트)──▶ FastAPI(app.py)
   └▶ summarizer: Files API로 영상 업로드 → ACTIVE 대기
        └▶ generate_content(model, [영상, 프롬프트], response_schema=SceneSummary)
             └▶ JSON 요약 반환 → Gemini/로컬 임시파일 정리
```

- Gemini 호출 **1번**으로 원본손실·생략·이상보존 세 요구를 한 번에 만족.

## 스택

- Python 3.11 · uv · FastAPI + uvicorn · google-genai (`from google import genai`) · pydantic · pytest · httpx(테스트)
- API 키: `../video-feedback/.env`의 `GEMINI_API_KEY` 로드 (자체 `.env` 폴백)
- 모델 기본값: `gemini-2.5-flash` (영상 지원·저렴·빠름), 설정으로 교체 가능. 정확 id는 빌드 때 1회 확인.

## 출력 스키마 (★ 이중 필드)

```json
{
  "full_observation": "시간순 전체 관찰(대사·표정·동작·톤). 손실 최소, 거의 생략 안 함",
  "summary":          "서브텍스트 대비 압축 요약. 불필요한 디테일 제거 (다음 LLM 1차 입력)",
  "intent_alignment": "상황/인물설정/서브텍스트 의도 대비 실제 연기가 어떻게 표현/이탈됐는지",
  "anomalies": [
    {"timestamp": "00:12", "what": "이상/부자연/의도이탈 관찰", "why_odd": "왜 눈에 띄는지"}
  ]
}
```

- `full_observation` = 원본손실 최소 보존
- `summary` = 생략 적용된 압축본 (다음 LLM 1차 입력)
- `anomalies` = **절대 생략 금지** (다음 챗 LLM이 "제일 큰 문제" 고를 후보)
- 요약 단계는 **점수/순위/판정 금지** — 그건 다음 챗 LLM 몫. 여긴 "사소해도 의심되면 다 적기".

## 컴포넌트 (작은 단위 분리)

| 파일 | 역할 | 의존 |
|---|---|---|
| `config.py` | `.env` 로드, 모델 id, 설정값 | os, dotenv |
| `schema.py` | Pydantic: 입력 `SubText`, 출력 `SceneSummary`/`Anomaly` | pydantic |
| `prompt.py` | 서브텍스트 주입 + 4규칙 프롬프트 빌더 | schema |
| `summarizer.py` | 핵심: 업로드→호출→파싱→정리. genai client 주입식(모킹 가능) | google-genai, schema, prompt, config |
| `app.py` | FastAPI: `POST /summarize`(multipart), `GET /health` | fastapi, summarizer, schema |

각 단위 계약:
- `prompt.build(subtext) -> str`: 서브텍스트 3필드를 프롬프트에 주입, 출력은 LLM 지시 문자열.
- `summarizer.summarize(video_path, subtext, *, client) -> SceneSummary`: client 주입으로 외부 호출 격리.
- `app`: HTTP 경계만 담당 (검증·임시파일·에러 매핑), 로직은 summarizer에 위임.

## 데이터 흐름

1. client가 multipart로 영상 + 상황/인물설정/서브텍스트 전송
2. app: 입력 검증 → 영상 임시 저장 → `summarizer.summarize(...)` 호출
3. summarizer: Files API 업로드 → ACTIVE 대기 → `generate_content(response_schema=SceneSummary)` → JSON 파싱
4. 정리: Gemini 파일 삭제 + 로컬 임시파일 삭제
5. app: `SceneSummary` JSON 반환

## 에러 처리

- 영상 없음/형식오류 → 422
- Files API ACTIVE 대기 타임아웃 → 504
- 응답 JSON 파싱 실패 → 1회 재시도 후 502
- API 키 없음 → 기동 시 즉시 명확한 에러

## 테스트 (TDD 순서)

1. `schema` 검증 (필수 필드, anomaly 구조)
2. `prompt` 빌더 — 서브텍스트 3필드가 출력에 들어가는지, 4규칙 포함 확인
3. `summarizer` — **genai 전부 mock**: 업로드/generate 모킹 → `SceneSummary` 반환, JSON 파싱·임시파일 삭제 검증
4. `/summarize` 엔드포인트 — FastAPI TestClient, summarizer mock
5. *(opt-in)* 실제 Gemini 1건 — `@pytest.mark.gemini`, 기본 skip, 명시 opt-in + 승인 시에만

## 헌법 준수 (유료 API)

- 유닛테스트는 **전부 mock → 실제 호출 0**
- **실제 Gemini 호출**(통합테스트·서버 실가동)은 **사용자 승인받고만** 실행

## 비가역성 / 위험

- 새 디렉토리 `acting-summary/`만 생성, 기존 코드 0 수정 → 완전 가역, 위험 낮음.
