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

`apps/web` does not use local practice-session seed data. Configure these values in `apps/web/.env.local` before running practice flows:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
NEXT_PUBLIC_SUPABASE_VIDEO_BUCKET=practice-videos

GEMINI_API_KEY=...
GEMINI_QUESTION_MODEL=gemini-3-flash-preview
```
