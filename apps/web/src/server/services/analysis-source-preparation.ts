type AnalysisSource = {
  storageBucket?: unknown;
  storagePath?: unknown;
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
