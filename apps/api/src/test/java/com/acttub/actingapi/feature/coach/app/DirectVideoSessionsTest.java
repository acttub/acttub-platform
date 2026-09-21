package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import com.acttub.actingapi.integration.observation.DirectVideoModel;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.acttub.actingapi.platform.web.ApiException;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class DirectVideoSessionsTest {
    private final UUID owner = UUID.randomUUID();
    private final DirectVideoModel model = mock(DirectVideoModel.class);
    private final FailureReporter failures = mock(FailureReporter.class);
    private final DirectVideoModel.Video video = new DirectVideoModel.Video("files/test", "gemini://test", "video/mp4");

    private DirectVideoSessions service(Clock clock) {
        when(model.model()).thenReturn("test-gemini");
        when(model.upload(any(), anyString())).thenReturn(video);
        when(model.ready(video)).thenReturn(true);
        return new DirectVideoSessions(model, failures, clock);
    }

    private UUID start(DirectVideoSessions sessions) throws Exception {
        Path path = Files.createTempFile("direct-video-test-", ".mp4");
        return sessions.start(owner, path, "video/mp4").id();
    }

    private DirectVideoSessions.View settled(DirectVideoSessions sessions, UUID id) throws Exception {
        long deadline = System.nanoTime() + Duration.ofSeconds(3).toNanos();
        while (System.nanoTime() < deadline) {
            var view = sessions.get(owner, id);
            if (java.util.List.of("ready", "failed", "finished").contains(view.status())) return view;
            Thread.sleep(10);
        }
        throw new AssertionError("experiment did not settle");
    }

    @Test
    void carriesTheSameVideoAndFullConversationWithoutAnAnalysisRecord() throws Exception {
        try (var sessions = service(Clock.systemUTC())) {
            when(model.reply(any(), anyList(), anyString()))
                    .thenReturn("왜 이 말을 건네나요?", "상대를 안심시키려는 말이군요.");
            UUID id = start(sessions);
            assertThat(settled(sessions, id).messages()).hasSize(1);
            sessions.send(owner, id, "안심시키려 했어요.");
            var result = settled(sessions, id);
            assertThat(result.messages()).extracting(DirectVideoModel.Message::text)
                    .containsExactly("왜 이 말을 건네나요?", "안심시키려 했어요.", "상대를 안심시키려는 말이군요.");
            var history = ArgumentCaptor.forClass(java.util.List.class);
            verify(model, times(2)).reply(eq(video), history.capture(), eq("너는 배우의 영상·대사·이전 대화를 바탕으로 연기를 돕는 코치다. 장면 전체를 보고, 어색하거나 의도가 잘 전달되지 않는 중요한 지점 하나를 구체적으로 짚어라. 목소리·시선의 변화 자체를 결점으로 삼거나, 부족한 점을 억지로 만들지 마라. 잘된 연기는 효과적인 선택을 짚고 발전을 도와라.\n첫 응답은 짧은 피드백 한 문장과, 그 지점을 풀 질문 한 문장으로 만든다. 가능한 의도 두 가지를 근거에서 유추해 “~하려는 건가요, 아니면 ~하려는 건가요?”처럼 자연스럽게 묻되 번호나 목록은 쓰지 마라. 두 의도는 답에 따라 코칭이 달라져야 하며, 정답처럼 제시하지 마라. 이미 알려진 의도는 활용하고, 근거가 부족하면 선택지를 지어내지 말고 필요한 사실 하나만 확인하라.\n이후에는 배우의 답과 정정을 반영해, 의도가 영상에서 어떻게 전달됐는지 연결하고 유용한 해석이나 실행 가능한 연기 선택 하나를 제공하라. 모르겠다는 답에는 단서와 설명으로 도와라. 추가 질문은 필요한 경우에만 하며, 같은 질문·조언·비교 실험을 반복하지 마라.\n관찰과 추측을 구분하고, 배우가 바로 이해할 수 있는 짧고 자연스러운 한국어로 코칭 문장만 출력하라."));
            assertThat(history.getAllValues().get(0)).isEmpty();
            assertThat(history.getAllValues().get(1)).hasSize(2);
            verify(model, times(1)).upload(any(), eq("video/mp4"));
            verify(model, never()).classify(any(), anyList(), anyString());
        }
    }

    @Test
    void rejectsOtherOwnersAndConcurrentMessages() throws Exception {
        CountDownLatch entered = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        try (var sessions = service(Clock.systemUTC())) {
            when(model.reply(any(), anyList(), anyString())).thenAnswer(call -> {
                entered.countDown(); release.await(2, TimeUnit.SECONDS); return "질문입니다.";
            });
            UUID id = start(sessions);
            assertThat(entered.await(2, TimeUnit.SECONDS)).isTrue();
            assertThatThrownBy(() -> sessions.get(UUID.randomUUID(), id)).isInstanceOf(ApiException.class)
                    .hasMessage("direct_video_not_found");
            assertThatThrownBy(() -> sessions.send(owner, id, "답변")).isInstanceOf(ApiException.class)
                    .hasMessage("direct_video_not_ready");
            release.countDown();
            settled(sessions, id);
        } finally { release.countDown(); }
    }

    @Test
    void failedReplyDoesNotCommitUnansweredUserMessageAndCanRetry() throws Exception {
        try (var sessions = service(Clock.systemUTC())) {
            when(model.reply(any(), anyList(), anyString())).thenReturn("첫 질문")
                    .thenThrow(new IllegalStateException("unavailable"))
                    .thenReturn("{\"route\":\"repair\"}", "정정한 내용을 반영했어요.");
            UUID id = start(sessions);
            settled(sessions, id);
            sessions.send(owner, id, "그런 뜻이 아니에요.");
            var failed = settled(sessions, id);
            assertThat(failed.messages()).hasSize(1);
            assertThat(failed.error()).isEqualTo("direct_video_generation_failed");
            sessions.send(owner, id, "그런 뜻이 아니에요.");
            assertThat(settled(sessions, id).messages()).hasSize(3);
        }
    }

    @Test
    void rejectsExpiredSessionsAndDeletesTheGeminiFile() throws Exception {
        Clock clock = mock(Clock.class);
        Instant start = Instant.parse("2026-09-21T00:00:00Z");
        when(clock.instant()).thenReturn(start);
        try (var sessions = service(clock)) {
            when(model.reply(any(), anyList(), anyString())).thenReturn("첫 질문");
            UUID id = start(sessions);
            settled(sessions, id);
            when(clock.instant()).thenReturn(start.plus(Duration.ofMinutes(31)));
            assertThatThrownBy(() -> sessions.get(owner, id)).hasMessage("direct_video_not_found");
            sessions.expire();
            verify(model, timeout(2000)).delete(video);
        }
    }

    @Test
    void finishingWordsUseTheSamePromptWithoutClassification() throws Exception {
        try (var sessions = service(Clock.systemUTC())) {
            when(model.reply(any(), anyList(), anyString())).thenReturn("답변입니다.");
            UUID id = start(sessions);
            settled(sessions, id);
            sessions.send(owner, id, "그만할게요");
            assertThat(settled(sessions, id).status()).isEqualTo("ready");
            sessions.send(owner, id, "조금 더 이야기해볼게요");
            assertThat(settled(sessions, id).messages()).hasSize(5);
            verify(model, never()).classify(any(), anyList(), anyString());
            verify(model, times(3)).reply(eq(video), anyList(), eq("너는 배우의 영상·대사·이전 대화를 바탕으로 연기를 돕는 코치다. 장면 전체를 보고, 어색하거나 의도가 잘 전달되지 않는 중요한 지점 하나를 구체적으로 짚어라. 목소리·시선의 변화 자체를 결점으로 삼거나, 부족한 점을 억지로 만들지 마라. 잘된 연기는 효과적인 선택을 짚고 발전을 도와라.\n첫 응답은 짧은 피드백 한 문장과, 그 지점을 풀 질문 한 문장으로 만든다. 가능한 의도 두 가지를 근거에서 유추해 “~하려는 건가요, 아니면 ~하려는 건가요?”처럼 자연스럽게 묻되 번호나 목록은 쓰지 마라. 두 의도는 답에 따라 코칭이 달라져야 하며, 정답처럼 제시하지 마라. 이미 알려진 의도는 활용하고, 근거가 부족하면 선택지를 지어내지 말고 필요한 사실 하나만 확인하라.\n이후에는 배우의 답과 정정을 반영해, 의도가 영상에서 어떻게 전달됐는지 연결하고 유용한 해석이나 실행 가능한 연기 선택 하나를 제공하라. 모르겠다는 답에는 단서와 설명으로 도와라. 추가 질문은 필요한 경우에만 하며, 같은 질문·조언·비교 실험을 반복하지 마라.\n관찰과 추측을 구분하고, 배우가 바로 이해할 수 있는 짧고 자연스러운 한국어로 코칭 문장만 출력하라."));
        }
    }

}
