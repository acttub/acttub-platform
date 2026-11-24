package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.acttub.actingapi.integration.llm.StructuredJson;
import com.acttub.actingapi.integration.llm.TextGenerator;
import com.acttub.actingapi.integration.observation.DirectVideoModel;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.integration.storage.StoredObjectMetadata;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.acttub.actingapi.support.RecordingLlmTelemetry;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** 연습 루프의 첫 응답: 모델이 여러 줄을 써도 배우에게는 질문 한 줄만 간다. */
class DirectVideoCoachFirstReplyTest {
    final TextGenerator oldGenerator = mock(TextGenerator.class);
    final DirectVideoModel model = mock(DirectVideoModel.class);
    final CoachVideoSource videos = mock(CoachVideoSource.class);
    final ObjectStorage storage = mock(ObjectStorage.class);
    final RecordingFailureReporter failures = new RecordingFailureReporter();
    final RecordingLlmTelemetry telemetry = new RecordingLlmTelemetry();
    final DirectVideoModel.Video file = new DirectVideoModel.Video("files/test", "gemini://test", "video/mp4");

    static final String DESIGN = "<설계>\n인물: 혼자 선 척 붙잡히길 바란다\n순간1: \"됐어\" | 보이는: 상대가 물러나게 | 없는: 상대가 붙잡게\n</설계>\n";
    static final String LINES = "처음부터 끝까지 같은 높이로 말해요.\n상대를 보지 않고 바닥을 보며 말해요.\n다음 테이크에서는 한 번쯤 상대를 보고 말해 봐도 좋아요.\n이 장면에서 인물은 상대한테서 결국 뭘 얻어 내고 싶었어요?";

    DirectVideoCoachFirstReplyTest() {
        when(videos.find(any(), any())).thenReturn(new CoachVideoSource.Video("owned/video.mp4", "video/mp4", "etag"));
        when(storage.downloadToPath(eq("owned/video.mp4"), any())).thenAnswer(call -> {
            Path path = call.getArgument(1);
            Files.writeString(path, "original video bytes");
            return new StoredObjectMetadata(20, "video/mp4", "\"etag\"");
        });
        when(model.upload(any(), eq("video/mp4"))).thenReturn(file);
        when(model.ready(file)).thenReturn(true);
        when(model.model()).thenReturn("gemini-3-flash-preview");
    }

    CoachEngine engine() {
        var coach = new DirectVideoCoach(model, videos, storage, failures, telemetry, true, CoachPersonas.NONE, null, 0,
                CoachVideoCache.NONE, true);
        return new CoachEngine(oldGenerator, failures, telemetry, true, java.util.Optional.of(coach));
    }

    CoachSessionSnapshot first() {
        return new CoachSessionSnapshot(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                StructuredJson.MAPPER.createObjectNode(), "", "", "", 8000, "그 외", "그 외", null, "open", "", List.of(),
                PriorContext.EMPTY, "legacy", 0, null, null).withCoachingState("three_layers_v1", 0, null, "open", "");
    }

    @Test void aFirstResponseOfManyLinesKeepsOnlyTheQuestion() {
        when(model.reply(eq(file), anyList(), anyString())).thenReturn(DESIGN + "<코치>\n" + LINES + "\n</코치>");
        var result = engine().start(first(), UUID.randomUUID());
        assertThat(result.reply().message()).isEqualTo("이 장면에서 인물은 상대한테서 결국 뭘 얻어 내고 싶었어요?");
    }
}
