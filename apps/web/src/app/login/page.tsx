import { AuthFlow } from "@/features/auth/auth-flow";
import { AuthShell } from "@/features/auth/auth-shell";
import { buildNoindexMetadata } from "@/lib/seo/site-metadata";

export const metadata = buildNoindexMetadata("로그인");

/** 웹 로그인(account.login, SOMA-834). 가입과 같은 흐름이고, 처음 온 계정이면 동의 단계로 이어진다. */
export default function LoginPage() {
  return (
    <AuthShell>
      <AuthFlow mode="login" />
    </AuthShell>
  );
}
