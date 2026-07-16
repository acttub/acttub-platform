# Web performance contract

## Goal

The anonymous landing page must score at least 90 in the mobile Lighthouse
Performance category on a production build. Lighthouse is run three times and
the median result is used so that a single unusually fast or slow run does not
decide the result.

Run the complete gate from the repository root:

```sh
pnpm perf
```

Use five runs for final verification:

```sh
LHCI_RUNS=5 pnpm perf
```

Reports are written to `apps/web/artifacts/lighthouse/mobile/` and are ignored
by Git.

## Acceptance criteria

The mobile median for `http://127.0.0.1:4317/` must satisfy every budget:

- Lighthouse Performance score: at least 90
- Largest Contentful Paint (LCP): at most 2.5 seconds
- Cumulative Layout Shift (CLS): at most 0.1
- Total Blocking Time (TBT): at most 200 milliseconds

TBT is a repeatable lab diagnostic, not a replacement for the field-only INP
metric. Completion also requires these commands to pass:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm --filter web test`
- `pnpm build`

## Coverage boundary

The initial automated gate covers only `/`, the public anonymous experience.
The following routes require authenticated or terms-specific state and must not
be added to anonymous Lighthouse collection:

- `/home`
- `/practice/new`
- `/practice/history`
- `/terms`

Without a seeded non-production session, those routes redirect to Google OAuth
and the report would measure the identity provider instead of Acttub. Add them
only after a deterministic test account and cookie-based Lighthouse setup are
available; do not automate an interactive Google sign-in.

## Lab score versus Core Web Vitals

The 0-100 result is a Lighthouse lab score. Actual Core Web Vitals are verified
after deployment with real-user Chrome UX Report or Search Console data. Their
rolling field-data window cannot be used as the inner development loop.

Keep the Lighthouse CI version pinned. A Lighthouse or Chrome version change
can change scoring, so upgrade intentionally and record a new baseline.
