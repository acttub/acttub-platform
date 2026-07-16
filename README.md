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
