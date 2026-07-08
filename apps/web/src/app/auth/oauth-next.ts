const DEFAULT_OAUTH_NEXT_PATH = "/practice";
const ALLOWED_OAUTH_NEXT_PATH_PREFIXES = ["/practice"];
const LOCAL_ORIGIN = "https://acttub.local";
const ENCODED_SLASH_OR_BACKSLASH = /%(?:2f|5c)/i;
const CONTROL_OR_BACKSLASH = /[\\\u0000-\u001F\u007F]/;

function isAllowedOAuthNextPath(path: string): boolean {
  return ALLOWED_OAUTH_NEXT_PATH_PREFIXES.some(
    (prefix) =>
      path === prefix ||
      path.startsWith(`${prefix}/`) ||
      path.startsWith(`${prefix}?`) ||
      path.startsWith(`${prefix}#`),
  );
}

export function sanitizeOAuthNextPath(value: string | null): string {
  if (!value) return DEFAULT_OAUTH_NEXT_PATH;
  if (!value.startsWith("/") || value.startsWith("//")) return DEFAULT_OAUTH_NEXT_PATH;
  if (CONTROL_OR_BACKSLASH.test(value) || ENCODED_SLASH_OR_BACKSLASH.test(value)) {
    return DEFAULT_OAUTH_NEXT_PATH;
  }

  let parsed: URL;
  try {
    parsed = new URL(value, LOCAL_ORIGIN);
  } catch {
    return DEFAULT_OAUTH_NEXT_PATH;
  }

  if (parsed.origin !== LOCAL_ORIGIN) return DEFAULT_OAUTH_NEXT_PATH;

  const sanitized = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  return isAllowedOAuthNextPath(sanitized) ? sanitized : DEFAULT_OAUTH_NEXT_PATH;
}
