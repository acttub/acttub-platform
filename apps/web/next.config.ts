import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

// rewrites로 acting-api를 same-origin 프록시해 CORS 없이 호출한다. 이 프록시는
// 로컬 dev뿐 아니라 배포된 front svc에서도 쓴다 — 운영은 back alb가 private
// subnet에 있어 브라우저가 백엔드에 직접 닿지 못하므로, Next 서버가 유일한
// 통로다. 개발 서버도 같은 경로를 탄다.
//
// 주의: rewrites는 빌드 시점에 routes-manifest.json으로 직렬화된다. 런타임
// 환경변수로는 바뀌지 않으므로 API_ORIGIN은 반드시 빌드할 때 주어야 한다.
// 기본값은 로컬 Spring Boot(:8080)다. 이관 기간에는 FastAPI(:8000)를 가리켰고,
// 파이썬이 사라진 뒤로도 8000이 남아 있으면 **로컬 개발 루프만** 조용히 죽는다 —
// 배포는 API_ORIGIN을 명시로 주고 CI는 컴파일만 보므로 어디서도 안 걸린다.
const apiOrigin =
  process.env.API_ORIGIN ?? process.env.DEV_API_ORIGIN ?? "http://127.0.0.1:8080";

const nextConfig: NextConfig = {
  // EC2에 node_modules 없이 배포하기 위한 자립 실행 번들(.next/standalone).
  // `next dev`에는 영향이 없다 — `next build`에서만 쓰인다.
  output: "standalone",
  // 이미지 최적화를 쓰지 않는다. 그럼에도 standalone 산출물에는 sharp의 플랫폼
  // 전용 바이너리가 딸려온다(Next의 의존성 트레이싱이 무조건 포함시킨다).
  // 맥에서 빌드해 리눅스로 옮길 때는 전송에서 제외한다 — 실제로 로드되지 않는다.
  // 자세한 내용은 docs/deploy/DEPLOY-VPC.md.
  images: { unoptimized: true },
  // 폰 등 다른 기기에서 dev 서버를 열 때 필요 (기본은 로컬만 허용).
  // 이 값만으로는 부족하다 — dev 서버가 loopback에만 붙어 있으면 폰이 소켓에
  // 닿지 못하므로 `pnpm dev:lan`으로 LAN 주소에 바인드해야 한다.
  //   DEV_HOST=172.16.103.192 DEV_ALLOWED_ORIGINS=172.16.103.192 pnpm dev:lan
  // 0.0.0.0으로 바인드하지 않는다 — HMR 소켓 주소가 깨지면서 하이드레이션이
  // 멈춰 화면이 아무 버튼도 안 먹는 상태가 된다(2026-07-21 확인).
  allowedDevOrigins: (process.env.DEV_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  async rewrites() {
    return [
      { source: "/v2/:path*", destination: `${apiOrigin}/v2/:path*` },
      { source: "/health", destination: `${apiOrigin}/health` },
    ];
  },
  // 상대역 리딩(/reading)은 브라우저 안에서 onnxruntime wasm 으로 음성을 만든다. 멀티스레드
  // wasm 에는 SharedArrayBuffer 가 필요하고, 그건 교차 출처 격리(COOP+COEP)가 켜진 문서에만 있다.
  // **이 경로에만** 건다 — COOP same-origin 을 사이트 전체에 걸면 Google/Apple 로그인 팝업이
  // opener 를 잃어 로그인이 끝나지 않는다(SOMA-447). credentialless 라 외부 CSS·모델(HF CDN)은
  // CORP 헤더 없이도 자격증명 없이 받아진다.
  async headers() {
    return [
      {
        source: "/reading/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
        ],
      },
      {
        source: "/reading",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
        ],
      },
    ];
  },
  // hwp.js 는 파일 경로로도 읽을 수 있게 만들어져 `fs` 를 부른다. 브라우저에는 없고
  // 우리는 바이트를 직접 넘기므로 빈 모듈로 바꾼다. 빌드는 webpack(`--webpack`), dev 는
  // Turbopack 이라 둘 다 적는다.
  turbopack: {
    resolveAlias: {
      fs: { browser: "./src/lib/reading/script/fs-stub.ts" },
    },
  },
  webpack(config, { isServer }) {
    if (!isServer) {
      config.resolve.fallback = { ...(config.resolve.fallback ?? {}), fs: false };
    }
    return config;
  },
};

/**
 * Sentry 빌드 플러그인. 하는 일은 소스맵 업로드 하나뿐이고, 이벤트를 보낼지 말지는
 * `src/lib/observability/sentry-shared.ts`의 DSN이 정한다.
 *
 * 세 가지를 일부러 끄거나 좁혀 두었다.
 *
 * - `tunnelRoute`: **쓰지 않는다.** 광고 차단기를 우회하려고 Route Handler를 만드는
 *   기능인데, 그러면 "서버 로직은 apps/web에 두지 않는다"는 경계가 무너진다
 *   (apps/web/CLAUDE.md). 차단기에 막히는 이벤트는 감수한다.
 * - `deleteSourcemapsAfterUpload`: 업로드한 소스맵을 산출물에서 지운다. `.next/standalone/`이
 *   그대로 EC2로 올라가므로 남겨 두면 배포물이 커지고 소스가 서버에 놓인다.
 * - `sourcemaps.disable`: 토큰이 없으면 업로드 단계를 건너뛴다. 로컬 `pnpm build`가
 *   토큰 없이도 통과해야 한다.
 */
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // CI 로그에는 업로드 결과를 남기고 로컬에서는 조용히 지나간다.
  silent: !process.env.CI,
  // 클라이언트 번들 전체로 업로드 범위를 넓히지 않는다 — 산출물만 커진다.
  widenClientFileUpload: false,
  disableLogger: true,
  // Vercel에 배포하지 않는다. EC2 + systemd다(docs/deploy/DEPLOY-VPC.md).
  automaticVercelMonitors: false,
  // 업로드하는 소스맵에 붙는 릴리스 이름은 런타임 init의 release와 **정확히 같아야**
  // 한다. 어긋나면 업로드는 성공하는데 이슈 화면의 스택트레이스는 난독화된 채로 남는다.
  // 자동 감지(git)에 맡기지 않고 같은 환경변수를 양쪽이 읽게 못박는다.
  release: { name: process.env.NEXT_PUBLIC_APP_COMMIT },
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
    deleteSourcemapsAfterUpload: true,
  },
});
