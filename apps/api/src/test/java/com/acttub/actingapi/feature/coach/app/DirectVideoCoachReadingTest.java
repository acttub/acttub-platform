package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import java.util.List;
import java.util.UUID;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.acttub.actingapi.integration.observation.DirectVideoModel;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.acttub.actingapi.support.RecordingLlmTelemetry;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import static org.mockito.Mockito.times;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import java.nio.file.Files;
import java.nio.file.Path;

/** 리딩 녹음으로 시작한 코칭(SOMA-791)이 실제 턴에서 타는 길: 이은 녹음 올리기, 대본 재료, 짧은 첫 응답 → 해 볼 것 → 정리. */
class DirectVideoCoachReadingTest {
    final DirectVideoModel model = mock(DirectVideoModel.class);
    final CoachVideoSource videos = mock(CoachVideoSource.class);
    final ObjectStorage storage = mock(ObjectStorage.class);
    final DirectVideoModel.Video uploaded = new DirectVideoModel.Video("files/a", "https://x/files/a", "audio/wav", true);
    int prepared;
    final java.util.List<Path> audios = new java.util.ArrayList<>();

    static final String MATERIAL = """
            [리딩 녹음]
            [대본]
            1. 민수(내 대사, 녹음 1): 가지 마, 제발.
            2. 지혜(상대 대사): 이미 늦었어.
            [소리 안 줄별 시간] 내 대사 녹음을 대본 순서대로 이었다.
            - 녹음 1: 0:00~0:02 "가지 마, 제발."
            [서버가 잰 소리]
            - 녹음 1: 다른 대사들보다 빨라요 (rate)
            """;

    static final String OPENING = """
            <설계>
            입력: 리딩 녹음 (음성만)
            고른 소리: 녹음 1 빨라요
            </설계>
            <코치>
            "가지 마"는 다른 대사들보다 빨라요. 이 말을 할 때 민수는 지혜한테서 무슨 말을 듣고 싶었어요?
            </코치>
            <보기>
            남아 줄게
            미안해
            다시 생각해 볼게
            </보기>""";

    DirectVideoCoachReadingTest() {
        when(model.model()).thenReturn("gemini-3-flash-preview");
        when(model.classify(anyList(), anyString(), anyList())).thenReturn("{\"signals\":[\"answered\"]}");
        when(model.upload(any(), eq("audio/wav"))).thenReturn(uploaded);
        when(model.ready(uploaded)).thenReturn(true);
    }

    CoachReadingAudio audio() {
        return (userId, practiceId, withAudio) -> {
            prepared++;
            Path file = null;
            if (withAudio) {
                try {
                    file = Files.createTempFile("reading-test-", ".wav");
                    Files.write(file, new byte[] {1, 2, 3});
                } catch (java.io.IOException e) {
                    throw new java.io.UncheckedIOException(e);
                }
                audios.add(file);
            }
            return new CoachReadingAudio.Prepared(file, "audio/wav", "rs:1", MATERIAL);
        };
    }

    DirectVideoCoach coach(CoachReadingAudio audio) {
        // 연습 루프 스위치가 꺼져 있어도 리딩 녹음 회차는 목적별 코칭을 탄다.
        return new DirectVideoCoach(model, videos, storage, new RecordingFailureReporter(), new RecordingLlmTelemetry(), false)
                .withReadingAudio(audio);
    }

    static CoachSessionSnapshot fresh() {
        return new CoachSessionSnapshot(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                StructuredJson.MAPPER.createObjectNode(), "", "", "", 0, "그 외", "그 외", null, "open", "", List.of(),
                PriorContext.EMPTY, "legacy", 0, null, null).withCoachingState("three_layers_v1", 0, null, "open", "")
                .withSessionPurpose("reading");
    }

    @Test void theOpeningUploadsTheJoinedRecordingAndAsksOneShortQuestion() {
        when(model.reply(eq(uploaded), anyList(), anyString())).thenReturn(OPENING);
        var result = coach(audio()).turn(fresh(), null, UUID.randomUUID());

        assertThat(result.reply().message())
                .isEqualTo("\"가지 마\"는 다른 대사들보다 빨라요. 이 말을 할 때 민수는 지혜한테서 무슨 말을 듣고 싶었어요?");
        verifyNoInteractions(videos, storage);
        verify(model).upload(any(), eq("audio/wav"));
        var prompts = ArgumentCaptor.forClass(String.class);
        verify(model).reply(eq(uploaded), anyList(), prompts.capture());
        assertThat(prompts.getValue()).contains("[리딩 녹음으로 하는 코칭]", "[이번 첫 응답: 리딩 녹음", "[리딩 녹음]",
                "1. 민수(내 대사, 녹음 1): 가지 마, 제발.", "[서버가 잰 소리]");
        var view = PurposeView.from("reading", result.session().coachingState());
        assertThat(view.purpose()).isEqualTo("reading");
        assertThat(view.step()).isEqualTo("hear");
        assertThat(view.choices()).extracting(PurposeView.Choice::label).contains("남아 줄게", "미안해", "다시 생각해 볼게");
        assertThat(result.session().status()).isEqualTo("open");
        assertThat(audios).allSatisfy(file -> assertThat(file).doesNotExist());
    }

    /** 10/27 dev 실제 녹음: 모델이 들린 것과 질문을 두 줄로 쓰면 질문 줄만 남아 들린 것이 사라졌다. */
    @Test void anOpeningOnTwoLinesKeepsWhatWasHeard() {
        when(model.reply(eq(uploaded), anyList(), anyString())).thenReturn(OPENING.replace(
                "\"가지 마\"는 다른 대사들보다 빨라요. 이 말을", "\"가지 마\"는 다른 대사들보다 빨라요.\n이 말을"));
        var result = coach(audio()).turn(fresh(), null, UUID.randomUUID());
        assertThat(result.reply().message())
                .isEqualTo("\"가지 마\"는 다른 대사들보다 빨라요.\n이 말을 할 때 민수는 지혜한테서 무슨 말을 듣고 싶었어요?");
    }

    @Test void theSecondReplyIsTheTryStepWithTheReadingTurnPrompt() {
        when(model.reply(eq(uploaded), anyList(), anyString())).thenReturn(OPENING,
                "붙잡고 싶었다면, \"가지 마\"가 빠른 건 그 마음과 달라요. 다시 읽을 때 지혜한테 무엇을 하면서 말해 볼래요?\n"
                        + "<보기>\n달래면서 말해 볼래요\n따지면서 말해 볼래요\n부탁하듯 말해 볼래요\n</보기>");
        var opened = coach(audio()).turn(fresh(), null, UUID.randomUUID());
        var result = coach(audio()).turn(opened.session(), "남아 줄게", UUID.randomUUID());

        var prompts = ArgumentCaptor.forClass(String.class);
        verify(model, times(2)).reply(eq(uploaded), anyList(), prompts.capture());
        assertThat(prompts.getValue()).contains("[리딩 녹음으로 하는 코칭]", "[리딩 녹음 코칭의 길]", "할 일: 그 대사에서 해 볼 것",
                "[리딩 녹음]");
        assertThat(PurposeView.from("reading", result.session().coachingState()).step()).isEqualTo("try");
        verifyNoInteractions(videos, storage);
    }

    @Test void stoppingClosesWithTheVideoInvitation() {
        when(model.reply(eq(uploaded), anyList(), anyString())).thenReturn(OPENING);
        var opened = coach(audio()).turn(fresh(), null, UUID.randomUUID());
        org.mockito.Mockito.clearInvocations(model);
        var done = coach(audio()).turn(opened.session(), "그만", UUID.randomUUID());

        assertThat(done.reply().message()).isEqualTo("오늘은 여기까지 해요. 그 한 줄을 영상으로 올리면 이어서 더 깊게 볼게요.");
        assertThat(done.session().closeReason()).isEqualTo("actor_finished");
        verify(model, never()).reply(any(), anyList(), anyString());
    }

    @Test void aQuotedLineThatIsNotInTheScriptIsDropped() {
        when(model.reply(eq(uploaded), anyList(), anyString())).thenReturn(OPENING.replace(
                "\"가지 마\"는 다른 대사들보다 빨라요. 이 말을",
                "\"가지 마\"는 다른 대사들보다 빨라요. \"너 없으면 안 돼\"처럼 들려요. 이 말을"));
        var result = coach(audio()).turn(fresh(), null, UUID.randomUUID());
        assertThat(result.reply().message()).contains("\"가지 마\"는 다른 대사들보다 빨라요.").doesNotContain("너 없으면");
    }

    @Test void withoutTheRecordingTheReplyIsUnavailable() {
        assertThatThrownBy(() -> coach(CoachReadingAudio.NONE).turn(fresh(), null, UUID.randomUUID()))
                .isInstanceOf(CoachReplyUnavailable.class);
        verify(model, never()).upload(any(), anyString());
    }
}
