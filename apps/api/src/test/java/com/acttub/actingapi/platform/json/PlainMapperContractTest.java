package com.acttub.actingapi.platform.json;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import tools.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

/**
 * 코드가 스프링 설정 없이 직접 만드는 매퍼(바깥 호출 본문, DB 에 넣는 JSON 문자열, 모델 출력 읽기)의 기본 동작을
 * 고정한다(SOMA-1103). 직접 만드는 자리는 모두 이 테스트의 {@link #MAPPER} 와 같은 방법으로 만든다. 기대값은
 * Jackson 2 의 {@code JsonMapper.builderWithJackson2Defaults().build()} 를 실제로 돌려 얻었다.
 */
class PlainMapperContractTest {

    private static final ObjectMapper MAPPER = JsonMapper.builderWithJackson2Defaults().build();

    enum Kind { FIRST_KIND, second }

    record Nested(String zeta, int alpha) {
    }

    record Body(String zeta, int alpha, double half, double whole, BigDecimal decimal, Long missing, boolean flag,
            Kind kind, List<Object> list, Map<String, Object> map, Nested nested, double notNumber) {
    }

    /**
     * getter 만 있는 클래스. 칸 순서는 Jackson 2·3 모두 {@code Class.getDeclaredMethods()} 가 주는 순서를 따른다.
     * HotSpot 은 이 순서를 메서드 이름 Symbol 의 메모리 주소로 정하고(method.cpp 의 method_comparator), 그 주소는
     * 먼저 올라간 클래스와 메모리 할당에 따라 JVM 마다 달라진다. 그래서 이 클래스는 칸 이름과 값만 본다.
     */
    static final class Bean {
        public String getZeta() {
            return "z";
        }

        public int getAlpha() {
            return 1;
        }

        public boolean isReady() {
            return true;
        }
    }

    /**
     * 필드가 있는 클래스. Jackson 은 필드를 먼저 모으므로 칸 순서가 필드 선언 순서로 정해지고, 필드 없는 getter
     * (ready)는 그 뒤에 온다. 필드 없는 getter 가 둘 이상이면 그 사이 순서는 {@link Bean} 처럼 정해지지 않는다.
     */
    static final class FieldBean {
        private final String zeta = "z";
        private final int alpha = 1;

        public String getZeta() {
            return zeta;
        }

        public int getAlpha() {
            return alpha;
        }

        public boolean isReady() {
            return true;
        }
    }

    record Primitive(int count, boolean flag, double ratio) {
    }

    record Text(String value) {
    }

    @Test
    @DisplayName("레코드·클래스·enum·숫자를 Jackson 2 때와 같은 바이트로 쓴다")
    void writesAsBefore() throws Exception {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("z", 1);
        map.put("a", null);
        Body body = new Body("마지막 \"따옴\" /슬래시\n줄   😀", 7, 0.5, 2.0, new BigDecimal("1.10"), null, true,
                Kind.FIRST_KIND, List.of(1, "두", 3.5, false), map, new Nested("n", 2), Double.NaN);

        assertThat(MAPPER.writeValueAsString(body)).isEqualTo(EXPECTED_BODY);
        assertThat(MAPPER.writeValueAsString(new FieldBean())).isEqualTo(EXPECTED_FIELD_BEAN);
        assertThat(MAPPER.writeValueAsString(MAPPER.readTree("{\"b\":1.50,\"a\":[2.0,1e400,12345678901234567890]}")))
                .isEqualTo(EXPECTED_TREE);
    }

    @Test
    @DisplayName("getter 만 있는 클래스는 칸 이름과 값을 Jackson 2 때와 같게 쓴다(칸 순서는 JVM 마다 다르다)")
    void writesGetterOnlyClassAsBefore() {
        // ObjectNode 의 equals 는 칸 순서를 보지 않는다.
        assertThat(MAPPER.readTree(MAPPER.writeValueAsString(new Bean()))).isEqualTo(MAPPER.readTree(EXPECTED_BEAN));
    }

    @Test
    @DisplayName("readTree·readValue 가 빈 문자열·중복 키·뒤에 붙은 토큰·형 맞추기를 Jackson 2 때와 같게 읽는다")
    void readsAsBefore() {
        assertThat(tree("")).isEqualTo(EXPECTED_EMPTY);
        assertThat(tree("   ")).isEqualTo(EXPECTED_BLANK);
        assertThat(tree("{\"a\":1,\"a\":2}")).isEqualTo(EXPECTED_DUPLICATE);
        assertThat(tree("{\"a\":1} trailing")).isEqualTo(EXPECTED_TREE_TRAILING);
        assertThat(tree("{\"a\":1}{\"b\":2}")).isEqualTo(EXPECTED_TREE_SECOND);
        assertThat(tree("null")).isEqualTo(EXPECTED_TREE_NULL);
        assertThat(tree("1.10")).isEqualTo(EXPECTED_TREE_DECIMAL);
        assertThat(read("{\"value\":\"a\",\"extra\":1}", Text.class)).isEqualTo(EXPECTED_UNKNOWN);
        assertThat(read("{\"value\":\"a\"} trailing", Text.class)).isEqualTo(EXPECTED_TRAILING);
        assertThat(read("{\"count\":null,\"flag\":null,\"ratio\":null}", Primitive.class)).isEqualTo(EXPECTED_NULL_PRIMITIVES);
        assertThat(read("{\"count\":\"3\",\"flag\":\"true\",\"ratio\":\"1.5\"}", Primitive.class)).isEqualTo(EXPECTED_STRINGS);
        assertThat(read("{\"count\":3.5,\"flag\":1,\"ratio\":1}", Primitive.class)).isEqualTo(EXPECTED_FLOAT_INT);
        assertThat(read("{\"value\":5}", Text.class)).isEqualTo(EXPECTED_NUMBER_TEXT);
        assertThat(read("{\"value\":\"a\",\"value\":\"b\"}", Text.class)).isEqualTo(EXPECTED_DUPLICATE_VALUE);
    }

    private static String tree(String json) {
        try {
            Object node = MAPPER.readTree(json);
            return node == null ? "<null>" : node.getClass().getSimpleName().replace("TextNode", "StringNode") + ":" + node;
        } catch (Exception exception) {
            return "ERROR";
        }
    }

    private static String read(String json, Class<?> type) {
        try {
            return String.valueOf(MAPPER.readValue(json, type));
        } catch (Exception exception) {
            return "ERROR";
        }
    }

    private static final String EXPECTED_BODY = "{\"zeta\":\"마지막 \\\"따옴\\\" /슬래시\\n줄 \u2028 😀\",\"alpha\":7,\"half\":0.5,\"whole\":2.0,\"decimal\":1.10,\"missing\":null,\"flag\":true,\"kind\":\"FIRST_KIND\",\"list\":[1,\"두\",3.5,false],\"map\":{\"z\":1,\"a\":null},\"nested\":{\"zeta\":\"n\",\"alpha\":2},\"notNumber\":\"NaN\"}";
    private static final String EXPECTED_BEAN = "{\"zeta\":\"z\",\"alpha\":1,\"ready\":true}";
    private static final String EXPECTED_FIELD_BEAN = "{\"zeta\":\"z\",\"alpha\":1,\"ready\":true}";
    private static final String EXPECTED_TREE = "{\"b\":1.5,\"a\":[2.0,\"Infinity\",12345678901234567890]}";
    private static final String EXPECTED_EMPTY = "MissingNode:";
    private static final String EXPECTED_BLANK = "MissingNode:";
    private static final String EXPECTED_DUPLICATE = "ObjectNode:{\"a\":2}";
    private static final String EXPECTED_TREE_TRAILING = "ObjectNode:{\"a\":1}";
    private static final String EXPECTED_TREE_SECOND = "ObjectNode:{\"a\":1}";
    private static final String EXPECTED_TREE_NULL = "NullNode:null";
    private static final String EXPECTED_TREE_DECIMAL = "DoubleNode:1.1";
    private static final String EXPECTED_UNKNOWN = "ERROR";
    private static final String EXPECTED_TRAILING = "Text[value=a]";
    private static final String EXPECTED_NULL_PRIMITIVES = "Primitive[count=0, flag=false, ratio=0.0]";
    private static final String EXPECTED_STRINGS = "Primitive[count=3, flag=true, ratio=1.5]";
    private static final String EXPECTED_FLOAT_INT = "Primitive[count=3, flag=true, ratio=1.0]";
    private static final String EXPECTED_NUMBER_TEXT = "Text[value=5]";
    /**
     * Jackson 2 와 다르다: 레코드에 같은 키가 두 번 오면 Jackson 2 는 정의 오류("No fallback setter/field defined for
     * creator property")를 내고 Jackson 3 은 뒤 값을 받는다. HTTP 요청 본문은 트리로 먼저 읽어 뒤 값이 이기므로 옮기기
     * 전후 같은 응답이다(boot-compare 의 duplicate-key·auth-duplicate-key 요청, SOMA-1103 진행 기록).
     */
    private static final String EXPECTED_DUPLICATE_VALUE = "Text[value=b]";
}
