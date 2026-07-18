import type { NextConfig } from "next";

// output:'export'와 rewrites는 상호 배타 — 정적 빌드는 BUILD_STATIC=1로 켠다.
// dev에서는 rewrites로 acting-api(:8000)를 same-origin 프록시해 CORS 없이 호출한다.
const isExport = process.env.BUILD_STATIC === "1";
const devApiOrigin = process.env.DEV_API_ORIGIN ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = isExport
  ? {
      output: "export",
      images: { unoptimized: true },
    }
  : {
      async rewrites() {
        return [
          { source: "/v2/:path*", destination: `${devApiOrigin}/v2/:path*` },
          { source: "/health", destination: `${devApiOrigin}/health` },
        ];
      },
    };

export default nextConfig;
