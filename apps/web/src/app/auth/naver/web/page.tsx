import { AuthFlow } from "@/features/auth/auth-flow";
import { AuthShell } from "@/features/auth/auth-shell";
import { buildNoindexMetadata } from "@/lib/seo/site-metadata";

// 웹 네이버 로그인이 돌아오는 자리(SOMA-834). 앱용 /auth/naver/callback 과 따로 둔다 — 그쪽은 앱 스킴으로 넘긴다.
export const metadata = buildNoindexMetadata("네이버 로그인");

export default function NaverWebCallbackPage() {
  return (
    <AuthShell>
      <AuthFlow mode="login" naverCallback />
    </AuthShell>
  );
}
