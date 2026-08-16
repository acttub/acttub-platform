package com.acttub.actingapi.report.app;

import com.fasterxml.jackson.core.JsonLocation;
import com.fasterxml.jackson.core.JsonProcessingException;

/** Python {@code json.JSONDecodeError.__str__}와 같은 파싱 오류 문구를 만든다. */
final class PythonJsonDecodeError {

    private PythonJsonDecodeError() {
    }

    static String expectingValueAtStart() {
        return "Expecting value: line 1 column 1 (char 0)";
    }

    static String format(JsonProcessingException exception, String source) {
        JsonLocation location = exception.getLocation();
        int line = location == null || location.getLineNr() < 1
                ? 1
                : location.getLineNr();
        int column = location == null || location.getColumnNr() < 1
                ? 1
                : location.getColumnNr();
        int charPosition = charPosition(source, line, column);
        return reason(exception.getOriginalMessage())
                + ": line " + line
                + " column " + column
                + " (char " + charPosition + ")";
    }

    private static String reason(String jacksonMessage) {
        String message = jacksonMessage == null ? "" : jacksonMessage;
        if (message.contains("double-quote to start field name")) {
            return "Expecting property name enclosed in double quotes";
        }
        if (message.contains("colon to separate field name and value")) {
            return "Expecting ':' delimiter";
        }
        if (message.contains("comma to separate")) {
            return "Expecting ',' delimiter";
        }
        if (message.contains("Unrecognized character escape")) {
            return "Invalid \\escape";
        }
        if (message.contains("Illegal unquoted character")) {
            return "Invalid control character at";
        }
        // LLM 스텁의 비 JSON 문자열과 알 수 없는 토큰은
        // Python json.loads가 내는 대표 사유인 Expecting value에 해당한다.
        return "Expecting value";
    }

    private static int charPosition(String source, int line, int column) {
        int index = 0;
        int currentLine = 1;
        while (index < source.length() && currentLine < line) {
            char value = source.charAt(index++);
            if (value == '\r') {
                if (index < source.length() && source.charAt(index) == '\n') {
                    index++;
                }
                currentLine++;
            } else if (value == '\n') {
                currentLine++;
            }
        }
        index = Math.min(source.length(), index + Math.max(0, column - 1));
        return source.codePointCount(0, index);
    }
}
