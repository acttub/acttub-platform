# acting-agent

acting-summary가 만든 요약(SceneSummary JSON)을 입력으로 받아,
배우가 '의도한 것'과 '실제 보인 것'의 차이를 스스로 말하게 만드는 대화형 코치 에이전트.

## 실행

```powershell
uv sync
uv run uvicorn acting_agent.app:create_app --factory   # FastAPI (/coach/start, /coach/reply)
uv run python coach_app.py                             # Gradio 수동 확인용 UI
```

API 키는 `../video-feedback/.env`의 `GEMINI_API_KEY`를 읽는다 (acting-summary와 동일).

## 테스트

```powershell
uv run pytest
```
