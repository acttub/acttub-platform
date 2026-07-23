function statusOf(error: unknown): number | undefined {
  if (error === null || typeof error !== 'object') return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

export async function deletePracticeSessionIdempotently(
  sessionId: string,
  deleteSession: (sessionId: string) => Promise<void>,
): Promise<void> {
  try {
    await deleteSession(sessionId);
  } catch (error) {
    if (statusOf(error) !== 404) throw error;
  }
}
