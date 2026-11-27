import Link from "next/link";
import type { ComponentProps } from "react";

type SiteLinkProps = ComponentProps<typeof Link>;

/**
 * 사이트 안 링크. 지금은 next/link 그대로다. 예전에는 리딩(/reading)으로 가는 링크만 일반 문서 이동으로 열었는데,
 * 웹 리딩을 없애면서 그 갈래도 지웠다. 호출부가 여럿이라 이름은 남긴다.
 */
export function SiteLink(props: SiteLinkProps) {
  return <Link {...props} />;
}
