export type SessionVisibility = "public" | "internal" | "deletion";
export interface OwnerSessionScopeInput { sessionId: string; userId: string; visibility: SessionVisibility }
export declare const applyOwnerSessionScope: <T>(query: T, input: OwnerSessionScopeInput) => T;
