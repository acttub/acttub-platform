# acting-summary

영상 + 서브텍스트(상황·인물설정·서브텍스트) → Gemini가 영상을 직접 보고 통합 요약 1개(JSON) 반환.
다음 단계 코칭 챗 LLM이 받아 쓰는 입력.

## 출력 (SceneSummary)

- `full_observation`: 시간순 전체 관찰, 손실 최소
- `summary`: 서브텍스트 대비 압축 요약 (다음 LLM 1차 입력)
- `intent_alignment`: 의도 대비 실제 연기 정렬/이탈
- `anomalies[]`: 이상징후(`timestamp`/`what`/`why_odd`), 절대 생략 안 함

## 실행

```powershell
cd C:\Users\RJS\Desktop\project\acting-summary
py -m uv sync

# FastAPI
py -m uv run uvicorn acting_summary.app:create_app --factory --reload
# POST http://127.0.0.1:8000/summarize  (multipart: video, situation, character, subtext)

# Gradio UI (수동 확인용)
py -m uv run python gradio_app.py
```

## 테스트

```powershell
py -m uv run pytest -q            # 유닛테스트 (전부 mock, 실제 호출 0)
py -m uv run pytest -m gemini     # 실제 Gemini 호출 (SAMPLE_VIDEO 필요, 비용 발생)
```

API 키는 `../video-feedback/.env`의 `GEMINI_API_KEY`를 읽는다 (`GEMINI_MODEL`로 모델 override).
