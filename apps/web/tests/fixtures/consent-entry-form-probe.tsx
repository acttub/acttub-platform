import {
  useConsentEntryForm,
  type ConsentEntryForm,
} from "@/features/practice/use-consent-entry-form";

const allowedEntries: string[] = [];

export function resetAllowedEntries(): void {
  allowedEntries.length = 0;
}

export function getAllowedEntries(): string[] {
  return allowedEntries;
}

export function ConsentEntryFormProbe({
  onRender,
}: {
  onRender: (value: ConsentEntryForm) => void;
}) {
  const form = useConsentEntryForm(async (entry) => {
    allowedEntries.push(entry.entry_status);
  });
  onRender(form);
  return <output>{form.consents.state}</output>;
}
