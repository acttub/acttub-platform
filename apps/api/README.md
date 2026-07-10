# acting-api-deploy

Render 배포용 스냅샷 repo. **원본 소스는 acttub org의 개별 repo들이며, 여기 직접 커밋하지 말 것.**

- 원본: acttub/acttub-ai-summary, acttub/acttub-ai-report, acttub/acttub-ai-agent + 로컬 acting-api
- 갱신: 로컬에서 `.\sync_deploy.ps1` 실행 → diff 확인 → commit/push → Render 자동 재배포
- 배포 설정: `render.yaml` (rootDir=acting-api, uv sync, uvicorn factory)
- 필수 환경변수 (Render 대시보드에서 설정): `API_KEYS`, `GEMINI_API_KEY`
- 선택: `RATE_LIMIT_PER_MIN`(기본 10), `GEMINI_MODEL`, `REPORT_STORE_PATH`

주의: Render 무료 인스턴스는 디스크가 휘발성 → 리포트 히스토리(`REPORT_STORE_PATH`)는 재시작/재배포 시 초기화됨.
