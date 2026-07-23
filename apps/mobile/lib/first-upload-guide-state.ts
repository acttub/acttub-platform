const KEY_PREFIX = 'acttub.firstUploadGuideSeen:';

export type FirstUploadGuideStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
};

export function firstUploadGuideSeenKey(ownerId: string): string {
  return `${KEY_PREFIX}${encodeURIComponent(ownerId)}`;
}

export async function shouldShowFirstUploadGuide(
  storage: FirstUploadGuideStorage,
  ownerId: string,
): Promise<boolean> {
  try {
    return (await storage.getItem(firstUploadGuideSeenKey(ownerId))) === null;
  } catch {
    return true;
  }
}

export async function markFirstUploadGuideSeen(
  storage: FirstUploadGuideStorage,
  ownerId: string,
): Promise<boolean> {
  try {
    await storage.setItem(firstUploadGuideSeenKey(ownerId), '1');
    return true;
  } catch {
    return false;
  }
}
