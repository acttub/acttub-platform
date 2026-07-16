# 진행 상황 (acting-summary)

> 한 줄: 영상+서브텍스트 → Gemini 통합 요약(JSON) → 다음 단계 챗 LLM 입력. FastAPI + Gradio.

## DONE
- config(.env 로드) / schema / prompt(4규칙) / summarizer(genai mock) / FastAPI(/summarize,/health, store 주입)
- (2026-07-03) 스키마 세분화: `full_observation` → `observation{timeline, dialogue(대사)·tempo(템포)·pitch(높낮이)·movement(움직임)·expression(표정·시선)·emotion(감정) 6축 + extra[]}`. anomaly why 3겹화: `why_odd + likely_cause + impact_on_intent`, `dimension` 태그 추가. 목표=JSON 하나만 봐도 자기완결. 테스트 20 passed.
- Gradio UI(`gradio_app.py`) — 수동 확인용
- 유닛테스트 전부 mock (실제 API 0), 16 passed. 통합테스트는 `-m gemini` opt-in.

## 실호출 검증 (DONE)
- ✅ **실제 Gemini 호출 정상 동작 확인** (2026-06-25). 모델 `gemini-2.5-flash` + Files API 흐름 OK.

## 다음 켰을 때
```powershell
cd C:\Users\RJS\Desktop\project\acting-summary
py -m uv run pytest -q
py -m uv run python gradio_app.py
```

## gotcha
- uv는 `py -m uv ...`. 모델 기본 `gemini-2.5-flash`(env `GEMINI_MODEL` override).
- 실제 Gemini 호출은 사용자 승인 후에만.
- summarizer는 client 주입식 → 전 계층 mock 가능.
- FastAPI 앱/라우터에는 게이트웨이가 생성한 store를 주입한다.
