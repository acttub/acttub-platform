# acttub-platform

Acttub platform monorepo.

## Structure

```text
apps/
  web/      Next.js frontend
  api/      Spring Boot backend, planned
  mobile/   React Native app, planned
packages/   Shared packages, planned
```

## Commands

```bash
pnpm install
pnpm dev       # run the Next.js web app
pnpm lint      # lint the web app
pnpm build     # build the web app
```

## Runtime configuration

`apps/web` does not use local practice-session seed data. Copy `apps/web/.env.example` to
`apps/web/.env.local`, then configure these values before running practice flows:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
NEXT_PUBLIC_SUPABASE_VIDEO_BUCKET=practice-videos

# 현재 acting-api 파이프라인 전용 서버 설정 (브라우저에 노출 금지)
ACTING_API_BASE_URL=...
ACTING_API_KEY=...

# 레거시 Gemini 호환 경로에서만 사용
GEMINI_API_KEY=...
GEMINI_QUESTION_MODEL=gemini-3-flash-preview
```

`ACTING_API_BASE_URL`, `ACTING_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`는 서버 전용입니다. `NEXT_PUBLIC_` 접두사를 붙이거나 클라이언트 번들로 전달하지 않습니다. 현재 acting-api 영상 제한은 `576716800` bytes(550 MiB)이며, migration 001의 Slice 1 기준이었던 `314572800` bytes(300 MiB)는 역사적 레거시 기준으로만 유지됩니다.

개발 DB 마이그레이션과 acting-api 연결을 분석 시작 전에 확인할 수 있습니다:

```bash
pnpm check:acting-runtime
```

독립 분석 워커는 작업 claim 전에 pinned host `ffprobe`의 `-version` boot check를 통과해야 합니다.
워커는 Storage 응답을 mode `0600` 임시 파일로 한 번만 스트리밍하고, 실제 ISO-BMFF 길이·video stream·MP4/MOV brand를 확인한 뒤 같은 파일을 `/summarize`에 보냅니다. `ANALYSIS_WORKER_FFPROBE_PATH`와 `ANALYSIS_WORKER_MEDIA_TMP_DIR`로 실행 파일/임시 디스크 위치를 지정합니다. 동시성별 최악의 임시 디스크 예산은 `550 MiB × ANALYSIS_WORKER_CONCURRENCY`에 운영 여유분을 더해 잡습니다.
