import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

// rewrites로 acting-api를 same-origin 프록시해 CORS 없이 호출한다. 이 프록시는
// 로컬 dev뿐 아니라 홈서버에서도 쓴다. API는 Compose 내부 네트워크에만 있어
// 공개 요청은 Cloudflare Tunnel과 Next 서버를 통과한다. dev·운영이 같은 경로를 탄다.
//
// 주의: rewrites는 빌드 시점에 routes-manifest.json으로 직렬화된다. 런타임
// 환경변수로는 바뀌지 않으므로 API_ORIGIN은 반드시 빌드할 때 주어야 한다.
// 기본값은 로컬 Spring Boot(:8080)다. 이관 기간에는 FastAPI(:8000)를 가리켰고,
// 파이썬이 사라진 뒤로도 8000이 남아 있으면 **로컬 개발 루프만** 조용히 죽는다 —
// 배포는 API_ORIGIN을 명시로 주고 CI는 컴파일만 보므로 어디서도 안 걸린다.
const apiOrigin = process.env.API_ORIGIN ?? "http://127.0.0.1:8080";

const nextConfig: NextConfig = {
  // 런타임 이미지에 필요한 의존성만 담는 자립 실행 번들(.next/standalone).
  // `next dev`에는 영향이 없다 — `next build`에서만 쓰인다.
  output: "standalone",
  // 이미지 최적화를 쓰지 않는다. 그럼에도 standalone 산출물에는 sharp의 플랫폼
  // 전용 바이너리가 딸려온다(Next의 의존성 트레이싱이 무조건 포함시킨다).
  // Dockerfile은 빌드·런타임을 같은 리눅스로 맞춰 해당 바이너리도 함께 복사한다.
  images: { unoptimized: true },
  // 참여작 공유 페이지(/e/<id>, challenge.share)는 메신저 미리보기 때문에 요청마다 서버에서 렌더하고, 그때
  // API 에 직접 묻는다(src/lib/api/v2/public-entry.ts). 런타임 이미지에는 API_ORIGIN 환경변수가 없어
  // rewrites 와 같은 값을 빌드 때 서버 번들에 굳힌다. 클라이언트 코드는 이 값을 읽지 않는다.
  env: { ACTTUB_SERVER_API_ORIGIN: apiOrigin },
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
  // rewrites 프록시가 API 응답을 기다리는 시간. Next 기본값은 30초라, 30초를 넘는 코치 답(분류·코치·줄이기 호출이
  // 이어지면 운영 답의 약 30%)이 앱·웹에 500으로 돌아갔다. API는 끝까지 답을 만들어 저장하므로 서버 기록에는
  // 남지 않았다(2026-10-11 dev 재현). 앱·웹은 코치 답을 120초까지 기다린다. 60초는 사용자 결정이다.
  experimental: { proxyTimeout: 60_000 },
  async rewrites() {
    return [
      { source: "/v2/:path*", destination: `${apiOrigin}/v2/:path*` },
      { source: "/health", destination: `${apiOrigin}/health` },
      // 포트폴리오 공개 페이지(SOMA-528 결정 I-8). 주소는 /p/<slug> 인데 slug 는 빌드 때 알 수
      // 없다. 프리렌더한 껍데기 하나(/p)를 서빙하고 브라우저가 경로에서 slug 를 읽는다 — slug
      // 마다 서버 렌더나 캐시 파일이 생기지 않는다. 한 단계만 받는다(/p/a/b 는 404).
      { source: "/p/:slug", destination: "/p" },
    ];
  },
  // /guide 는 블로그로 합쳤다(SOMA-834). 검색 노출을 이어받도록 영구(308) 이동이다.
  async redirects() {
    return [
      { source: "/guide", destination: "/blog", permanent: true },
      { source: "/guide/:slug", destination: "/blog/:slug", permanent: true },
      // 웹의 코칭·리딩·연습 기능은 없앴다(SOMA-1087 뒤 코드까지 삭제). 옛 연습 주소는 앱 설치 안내(/app)로
      // 영구(308) 이동한다. 쿼리(utm 등)는 Next 가 그대로 이어 붙인다.
      ...["/reading", "/reading/:path*", "/practice", "/practice/:path*", "/home", "/library", "/library/:path*", "/memory"].map(
        (source) => ({ source, destination: "/app", permanent: true as const }),
      ),
    ];
  },
  async headers() {
    return [
      {
        source: "/fonts/pretendard/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
};

/**
 * Sentry 빌드 플러그인. 이벤트를 보낼지 말지는 `src/lib/observability/sentry-shared.ts`의 DSN이 정한다.
 * 인증 토큰을 주지 않으므로 소스맵을 올리거나 Sentry에 릴리스를 만들지 않는다.
 *
 * 두 가지를 일부러 꺼 두었다.
 *
 * - `tunnelRoute`: **쓰지 않는다.** 광고 차단기를 우회하려고 Route Handler를 만드는
 *   기능인데, 그러면 "서버 로직은 apps/web에 두지 않는다"는 경계가 무너진다
 *   (apps/web/CLAUDE.md). 차단기에 막히는 이벤트는 감수한다.
 * - `sourcemaps.disable`: 소스맵을 만들지 않는다. 빼면 플러그인이 webpack의 소스맵 생성을 켠다.
 */
export default withSentryConfig(nextConfig, {
  // 빌드 플러그인 자체의 사용 정보 전송은 끈다. 앱의 오류 수집은 런타임 DSN 설정을 따른다.
  telemetry: false,
  // 플러그인 로그를 끈다. 토큰이 없어 빌드마다 릴리스를 만들지 않는다는 경고만 찍힌다.
  silent: true,
  webpack: {
    treeshake: { removeDebugLogging: true },
    // 배포는 홈서버 Compose가 맡는다(docs/deploy/DEPLOY-HOME.md).
    automaticVercelMonitors: false,
  },
  // 플러그인이 번들에 새기는 릴리스 이름(SENTRY_RELEASE)을 런타임 init의 release와 같은 값으로 못박는다.
  // 비우면 플러그인이 git이나 CI 환경변수에서 다른 값을 찾아 새긴다.
  release: { name: process.env.NEXT_PUBLIC_APP_COMMIT },
  sourcemaps: { disable: true },
});
