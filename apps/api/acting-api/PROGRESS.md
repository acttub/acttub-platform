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

## DONE (2026-07-10) — Render 배포 준비
- 배포 전략: Render 무료 티어 + 스냅샷 repo (`ryujisung/acting-api-deploy`, private)
  - 이유: 형제 3개 프로젝트가 acttub org 개별 repo라 모노레포 불가 → 스냅샷 복사 방식
- router.py 리팩토링을 세 org repo 기본 브랜치에 커밋/푸시 완료 (백업)
- `C:\Users\RJS\Desktop\project\acting-api-deploy\` 생성: 4개 프로젝트 소스 복사(+.env/데이터 제외), render.yaml, sync_deploy.ps1
- 스냅샷 레이아웃에서 검증: uv sync --frozen + 테스트 12 passed + /health 200 + 무키 401
- 코드 갱신 시: `acting-api-deploy`에서 `.\sync_deploy.ps1` → commit/push → Render 자동 재배포

## DONE (2026-07-10) — 배포 완료 ✅
- Render 서비스 live: **https://acting-api.onrender.com** (Blueprint managed, free tier)
- env: API_KEYS + GEMINI_API_KEY 대시보드에 설정됨 (GEMINI 키는 video-feedback\.env 것 사용)
- 배포 스모크: /health 200, 무키 요청 401 확인

## DONE (2026-07-10) — 실호출 e2e ✅
- 배포된 서비스에 실 Gemini 호출 검증 (사용자 승인 하): POST /report (샘플 세션, flash 1회) → 200 + 정상 리포트 생성, /report/history 저장 확인
- 남은 유료 검증 없음 — summarize/coach도 같은 클라이언트·인증 경로라 게이트웨이 레벨은 검증된 것으로 간주

## DONE (2026-07-10) — 문서화
- API 명세서 HTML 작성: `project\acting-api_명세서.html` (외부 개발자 배포용, 실키 없음)
- Confluence 정리 페이지: https://hiws99.atlassian.net/wiki/spaces/SCRUM/pages/32931842 — Jira SOMA-182 설명란에 링크 연결됨 (티켓 상태는 "진행 중" 유지, 완료 전환은 사용자 결정)

## 진행 중 (2026-07-11) — Swagger Authorize 버튼
- app.py에 APIKeyHeader 스킴 추가 (검증은 기존 미들웨어, auto_error=False라 동작 불변). 테스트 12 passed
- deploy repo에 커밋 `aacdb04` push 완료 — 그런데 **Render 자동 배포 안 걸림**
- 원인 추정: deploy repo가 `ryujisung` → `acttub` org로 이전되면서 Render webhook 끊김
- 해결 대기: Render 대시보드에서 Manual Deploy 또는 repo 재연결 (사용자 액션 필요)
- 로컬 remote는 acttub URL로 갱신 완료

## DONE (2026-07-11) — 콜드스타트 방지 (self-ping) 구현 ✅
- `keepalive.py` 신규: `KEEP_ALIVE_URL` env 있으면 lifespan 백그라운드 태스크가 interval(기본 600s, `KEEP_ALIVE_INTERVAL_SEC`)마다 자기 `/health` GET. env 없으면 완전 off (로컬/테스트 자동 비활성)
- httpx 런타임 dep 추가. ping 실패는 warning 로그만, 루프 지속
- 테스트 6개 추가 (env 파싱 / 루프 / 앱 연결, 실 네트워크 0) → 총 18 passed
- sync_deploy.ps1 BOM 버그 수정: UTF-8 no-BOM이라 PS 5.1이 ANSI로 읽어 `$src` 할당 줄이 주석에 붙음 → UTF-8 BOM으로 재저장

## TODO — 다음 세션 여기서부터
- [ ] Render 대시보드 (사용자 액션): ① env `KEEP_ALIVE_URL=https://acting-api.onrender.com` 추가 ② webhook 끊겨 있으면 Manual Deploy 또는 repo 재연결
- [ ] 배포 검증: 15분+ 방치 후 /health 즉답(슬립 안 걸림) 확인

## gotcha (배포)
- 앱이 시작 시점에 GEMINI_API_KEY 없으면 즉시 크래시 (fail-fast) → Render env 필수
- Render 무료: 15분 유휴 슬립(콜드스타트 ~1분), 디스크 휘발성(리포트 히스토리 재시작 시 초기화), 인메모리 rate limit도 리셋

## gotcha
- 게이트웨이 클라이언트/settings 전부 주입식 → 테스트 mock 가능 (세 프로젝트와 동일 패턴)
- 코치 발화 픽스처에 타임스탬프(00:12 등)·금지어 넣으면 guard가 LLM 재시도 → fake 응답 순서 꼬임 (tests/support.py 참고)
- rate limit은 인메모리 → 재시작하면 리셋, 프로세스 1개 전제
- 서버는 Start-Process(분리 프로세스)로 띄울 것 (백그라운드 태스크는 세션 종료 시 죽음)
