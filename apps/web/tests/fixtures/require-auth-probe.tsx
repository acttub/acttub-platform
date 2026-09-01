import { useRequireAuth } from "@/features/auth/use-require-auth";

export type RequireAuthProbeValue = ReturnType<typeof useRequireAuth>;

export function RequireAuthProbe({
  onRender,
}: {
  onRender: (value: RequireAuthProbeValue) => void;
}) {
  const value = useRequireAuth();
  onRender(value);
  return <output>{value.ready ? "ready" : "waiting"}</output>;
}
