import { AuthFlow } from "@/features/auth/auth-flow";
import { AuthShell } from "@/features/auth/auth-shell";
import { buildNoindexMetadata } from "@/lib/seo/site-metadata";

export const metadata = buildNoindexMetadata("가입하기");

/** 웹 가입(account.signup, SOMA-834). 소셜 선택 → 동의 → 완료. 앱과 같은 계정이다. */
export default function SignupPage() {
  return (
    <AuthShell>
      <AuthFlow mode="signup" />
    </AuthShell>
  );
}
