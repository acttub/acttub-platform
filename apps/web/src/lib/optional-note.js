export const optionalNoteLength = (value) => Array.from(value).length;
export const normalizeOptionalNote = (value) => {
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
};
