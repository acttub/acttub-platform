import { ConsentEntryBoundary } from "@/features/auth/consent-entry-boundary";

export function ConsentEntryBoundaryProbe({
  onRender,
}: {
  onRender: (value: string) => void;
}) {
  onRender("rendered");
  return (
    <ConsentEntryBoundary>
      <output>service-content</output>
    </ConsentEntryBoundary>
  );
}
