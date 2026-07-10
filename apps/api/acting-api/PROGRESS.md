# 진행 상황 (acting-api)

> 한 줄: summary+coach+report 통합 게이트웨이. X-API-Key 인증 + 키별 rate limit. 외부 개발자 제공용.

## DONE (2026-07-08)
- 기존 3개 프로젝트 `app.py` → `router.py`(APIRouter) 분리 리팩토링 (동작 불변, 각자 테스트 43/38/17 그린)
- acting-api 신규: uv path deps(editable)로 3개 패키지 참조, 프로세스 1개
- 미들웨어: X-API-Key(env `API_KEYS`, 미설정 시 503 fail-closed) + 키별 분당 rate limit(env `RATE_LIMIT_PER_MIN`, 기본 10 → 429). 면제: /health /docs /openapi.json /redoc
- URL: /summarize, /coach/start, /coach/reply, /report, /report/history/{user_id}, /health(통합), /docs(Swagger 하나)
- 테스트 12 passed (인증/ratelimit/라우팅, 전부 mock, 실 Gemini 호출 0)
- 로컬 기동 + 스모크(401/200/docs) 확인. API 키는 `acting-api/.env`
- cloudflared 단독 실행파일 설치됨: `%LOCALAPPDATA%\cloudflared\cloudflared.exe` (winget은 UAC 대기로 실패). 터널 오픈은 사용자 결정 대기 — `.\start_server.ps1 -Tunnel`

## 다음 켰을 때
```powershell
cd C:\Users\RJS\Desktop\project\acting-api
py -m uv run pytest -q
py -m uv run uvicorn acting_api.app:create_app --factory --port 8000
cloudflared tunnel --url http://localhost:8000   # 외부 공유용 임시 URL
```

## TODO
- [ ] 고정 배포 (클라우드 or cloudflared named tunnel) — 지금은 quick tunnel(임시 URL)
- [ ] 실호출 end-to-end (유료 — 사용자 승인 후)

## gotcha
- 게이트웨이 클라이언트/settings 전부 주입식 → 테스트 mock 가능 (세 프로젝트와 동일 패턴)
- 코치 발화 픽스처에 타임스탬프(00:12 등)·금지어 넣으면 guard가 LLM 재시도 → fake 응답 순서 꼬임 (tests/support.py 참고)
- rate limit은 인메모리 → 재시작하면 리셋, 프로세스 1개 전제
- 서버는 Start-Process(분리 프로세스)로 띄울 것 (백그라운드 태스크는 세션 종료 시 죽음)
