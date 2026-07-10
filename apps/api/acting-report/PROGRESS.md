# 진행 상황 (acting-report)

> 한 줄: 3층. 코치 대화(CoachSession)+요약을 받아 **가장 큰 문제 하나만** 사용자 친화 리포트.
> 리포트는 user_id별 파일 저장 → 다음 영상 때 "저번엔 이랬는데" 비교(comparison).

## DONE (2026-07-05)
- 스캐폴딩: config(.env는 ../video-feedback/.env 재사용) / summary_schema·session_schema(사본) / schema / prompt / engine / store / FastAPI app
- 출력 스키마 `ActingReport`: headline · biggest_problem(구간+축+쉬운말) · evidence(관찰+배우 발언 인용) · self_discovery · encouragement · **next_step(다음에 뭘 할지 1개)** · **comparison(이전 리포트 대비 변화, 없으면 "")**
- 저장: `FileReportStore` — `data/reports.json` (env `REPORT_STORE_PATH` override), user_id별 히스토리, 재시작에도 유지
- API: `POST /report` (user_id+session → 리포트 생성+저장, 이전 리포트 자동 주입), `GET /report/history/{user_id}`, `GET /health`
- 테스트 17 passed, 전부 mock (실제 API 호출 0)

## DONE (2026-07-05, 추가)
- Gradio 수동 확인 UI(`gradio_app.py`): 세션 JSON + (summary 없으면) 요약 JSON 별도 업로드 지원, 에러는 친절 문구로 표시
- 예시 파일: `samples/session_example.json`(완전한 세션), `samples/summary_example.json`(요약만)

## TODO
- [ ] 실호출 검증 (사용자 승인 후에만 — 유료 API)
- [ ] 4층 연동: summary → agent 대화 → report 파이프라인 end-to-end

## 다음 켰을 때
```powershell
cd C:\Users\RJS\Desktop\project\acting-report
py -m uv run pytest -q
py -m uv run uvicorn acting_report.app:create_app --factory
```

## gotcha
- Gradio 띄울 때 포트 겹침 주의: summary=7860, agent=7861, report=7862 (`$env:GRADIO_SERVER_PORT`로 고정). 백그라운드 태스크로 띄우면 죽으니 `Start-Process`(분리 프로세스)로.
- uv는 `py -m uv ...`. 모델 기본 `gemini-2.5-flash`(env `GEMINI_MODEL`).
- engine은 client 주입식 → 전 계층 mock 가능 (앞 두 층과 동일 패턴).
- 실패(502) 시 리포트는 저장 안 됨.
- 리포트 톤: 부드러운 반말, 점수·등급·연기력 표현 금지 (코치 철학 유지).
