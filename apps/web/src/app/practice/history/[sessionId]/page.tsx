import { PipelineSessionDetail } from "@/features/practice/pipeline/session-detail";

export default async function PracticeHistorySessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return <PipelineSessionDetail sessionId={sessionId} />;
}

