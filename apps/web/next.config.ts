import type { NextConfig } from "next";

// output:'export'와 rewrites는 상호 배타 — 정적 빌드는 BUILD_STATIC=1로 켠다.
// rewrites로 acting-api를 same-origin 프록시해 CORS 없이 호출한다. 이 프록시는
// 로컬 dev뿐 아니라 VPC 배포의 front svc에서도 쓴다 — back alb가 private subnet에
// 있어 브라우저가 백엔드에 직접 닿지 못하므로, Next 서버가 유일한 통로다.
const isExport = process.env.BUILD_STATIC === "1";
// 주의: rewrites는 빌드 시점에 routes-manifest.json으로 직렬화된다. 런타임
// 환경변수로는 바뀌지 않으므로 API_ORIGIN은 반드시 빌드할 때 주어야 한다.
const apiOrigin =
  process.env.API_ORIGIN ?? process.env.DEV_API_ORIGIN ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = isExport
  ? {
      output: "export",
      images: { unoptimized: true },
    }
  : {
      // EC2에 node_modules 없이 배포하기 위한 자립 실행 번들(.next/standalone).
      // `next dev`에는 영향이 없다 — `next build`에서만 쓰인다.
      output: "standalone",
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
    };

export default nextConfig;
