type AnalysisSource = {
  storageBucket?: unknown;
  storagePath?: unknown;
  mimeType?: unknown;
};

type AnalysisRelayMetadata = {
  fileName: "take.mp4" | "take.mov";
  mimeType: "video/mp4" | "video/quicktime";
};

type SignedUrlResult = {
  data: { signedUrl?: string } | null;
  error: unknown;
};

type StorageAdminClient = {
  storage: {
    from(bucket: string): {
      createSignedUrl(path: string, expiresIn: number): Promise<SignedUrlResult>;
    };
  };
};

type SourcePreparationDependencies = {
  createAdminClient(): StorageAdminClient | null;
  fetchVideo(input: string): Promise<Response>;
};

export class AnalysisSourcePreparationError extends Error {
  readonly code = "source_video_unavailable";

  constructor() {
    super("The source video is temporarily unavailable.");
    this.name = "AnalysisSourcePreparationError";
  }
}

export class AnalysisSourceMetadataError extends Error {
  readonly code = "source_video_metadata_invalid";

  constructor() {
    super("The source video metadata is invalid.");
    this.name = "AnalysisSourceMetadataError";
  }
}

export function deriveAnalysisRelayMetadata(
  source: AnalysisSource,
  userId: string,
  sessionId: string,
): AnalysisRelayMetadata {
  const storagePath = source.storagePath;
  const mimeType = source.mimeType;
  const canonicalSources: AnalysisRelayMetadata[] = [
    { fileName: "take.mp4", mimeType: "video/mp4" },
    { fileName: "take.mov", mimeType: "video/quicktime" },
  ];
  const metadata = canonicalSources.find(
    (candidate) =>
      storagePath ===
        `users/${userId}/practice-sessions/${sessionId}/${candidate.fileName}` &&
      mimeType === candidate.mimeType,
  );

  if (!metadata) throw new AnalysisSourceMetadataError();
  return metadata;
}

export async function prepareAnalysisVideoSource(
  source: AnalysisSource,
  dependencies: SourcePreparationDependencies,
): Promise<ReadableStream<Uint8Array>> {
  try {
    const admin = dependencies.createAdminClient();
    if (!admin) throw new AnalysisSourcePreparationError();

    const signed = await admin.storage
      .from(String(source.storageBucket))
      .createSignedUrl(String(source.storagePath), 900);
    if (signed.error || !signed.data?.signedUrl) {
      throw new AnalysisSourcePreparationError();
    }

    const video = await dependencies.fetchVideo(signed.data.signedUrl);
    if (!video.ok || !video.body) {
      throw new AnalysisSourcePreparationError();
    }
    return video.body;
  } catch (error) {
    if (error instanceof AnalysisSourcePreparationError) throw error;
    throw new AnalysisSourcePreparationError();
  }
}

export async function prepareAnalysisRelaySource(
  source: AnalysisSource,
  userId: string,
  sessionId: string,
  dependencies: SourcePreparationDependencies,
): Promise<AnalysisRelayMetadata & { video: ReadableStream<Uint8Array> }> {
  const metadata = deriveAnalysisRelayMetadata(source, userId, sessionId);
  const video = await prepareAnalysisVideoSource(source, dependencies);
  return { ...metadata, video };
}
