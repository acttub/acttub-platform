export function sortReportsNewestFirst<T extends { created_at: string }>(
  records: readonly T[],
): T[] {
  return [...records].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  );
}
