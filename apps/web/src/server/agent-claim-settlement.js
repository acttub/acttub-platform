export const settleAgentClaimProgress = async ({ claimed, readAggregate, failRun, expectedSubstantiveAnswerCount, expectedTotalConversationCount, actorTurnCount, staleError, persistenceError, attempts = 2 }) => {
  if (claimed.run.status === "completed" || (claimed.run.status !== "pending" && claimed.run.status !== "running")) return claimed;
  let current;
  try { current = await readAggregate(); } catch { throw persistenceError(); }
  const exact = current.runs.find((run) => run.id === claimed.run.id);
  if (exact?.status === "completed" || exact?.status === "failed") return { owned: false, run: exact };
  if (current.substantiveAnswerCount === expectedSubstantiveAnswerCount && actorTurnCount(current) === expectedTotalConversationCount) return claimed;
  if (exact?.status === "pending" || (!exact && claimed.run.status === "pending")) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try { current = await readAggregate(); } catch { if (attempt + 1 === attempts) throw persistenceError(); continue; }
      const observed = current.runs.find((run) => run.id === claimed.run.id);
      if (observed?.status === "completed" || observed?.status === "failed") return { owned: false, run: observed };
    }
    throw persistenceError();
  }
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { await failRun(claimed.run.id); } catch { /* authoritative observation below */ }
    try { current = await readAggregate(); } catch { if (attempt + 1 === attempts) throw persistenceError(); continue; }
    const observed = current.runs.find((run) => run.id === claimed.run.id);
    if (observed?.status === "completed") return { owned: false, run: observed };
    if (observed?.status === "failed") throw staleError();
  }
  throw persistenceError();
};
