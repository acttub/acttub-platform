package com.acttub.actingapi.platform.observability;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.ConnectException;
import java.net.http.HttpTimeoutException;
import java.sql.SQLException;
import java.util.concurrent.TimeoutException;
import java.util.stream.Stream;

import com.acttub.actingapi.feature.analysis.app.ObjectETagMismatchError;
import com.acttub.actingapi.feature.report.app.ReportParseError;
import com.acttub.actingapi.integration.llm.OpenAiConnectionException;
import com.acttub.actingapi.integration.observation.FileActiveTimeout;
import com.acttub.actingapi.integration.observation.SummaryParseError;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.dao.DataAccessResourceFailureException;
import software.amazon.awssdk.core.exception.SdkClientException;

class FailureClassifierTest {

    @ParameterizedTest
    @MethodSource("externalCauses")
    void classifiesKnownExternalCausesAnywhereInTheCauseChain(Throwable cause) {
        RuntimeException wrapper = new RuntimeException("wrapper", cause);

        assertThat(FailureClassifier.classify(wrapper)).isEqualTo(FailureKind.EXTERNAL);
    }

    @ParameterizedTest
    @MethodSource("markedExternalFailures")
    void classifiesTheFiveMarkedFailuresAsExternal(Throwable failure) {
        assertThat(FailureClassifier.classify(failure)).isEqualTo(FailureKind.EXTERNAL);
    }

    @Test
    void classifiesUnrecognizedFailuresAsUnexpected() {
        assertThat(FailureClassifier.classify(new IllegalStateException("broken invariant")))
                .isEqualTo(FailureKind.UNEXPECTED);
    }

    private static Stream<Throwable> externalCauses() {
        return Stream.of(
                SdkClientException.builder().message("AWS unavailable").build(),
                new DataAccessResourceFailureException("database unavailable"),
                new SQLException("database unavailable"),
                new TimeoutException("timed out"),
                new HttpTimeoutException("HTTP timed out"),
                new ConnectException("connection refused"));
    }

    private static Stream<Throwable> markedExternalFailures() {
        return Stream.of(
                new OpenAiConnectionException(new IllegalArgumentException("transport rejected")),
                new SummaryParseError("Gemini summary was invalid"),
                new ReportParseError("report was invalid"),
                new FileActiveTimeout("Gemini file did not become active"),
                new ObjectETagMismatchError("S3 object changed"));
    }
}
