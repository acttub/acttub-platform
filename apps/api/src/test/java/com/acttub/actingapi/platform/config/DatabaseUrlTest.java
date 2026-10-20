package com.acttub.actingapi.platform.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class DatabaseUrlTest {

    @Test
    @DisplayName("배포에서 쓰는 postgresql:// URI 를 JDBC URL + 자격증명으로 쪼갠다")
    void parsesDeploymentUrl() {
        DatabaseUrl parsed = DatabaseUrl.parse("postgresql://acting:s3cret@db.internal:5432/acting");

        assertThat(parsed.jdbcUrl()).isEqualTo("jdbc:postgresql://db.internal:5432/acting");
        assertThat(parsed.username()).isEqualTo("acting");
        assertThat(parsed.password()).isEqualTo("s3cret");
    }

    @Test
    @DisplayName("postgres:// 스킴도 받는다 (SQLAlchemy 쪽 normalize_database_url 과 같은 범위)")
    void parsesPostgresScheme() {
        DatabaseUrl parsed = DatabaseUrl.parse("postgres://u:p@h/dbname");

        assertThat(parsed.jdbcUrl()).isEqualTo("jdbc:postgresql://h:5432/dbname");
    }

    @Test
    @DisplayName("포트를 생략하면 5432 로 채운다")
    void defaultsPort() {
        assertThat(DatabaseUrl.parse("postgresql://u:p@h/db").jdbcUrl())
                .isEqualTo("jdbc:postgresql://h:5432/db");
    }

    @Test
    @DisplayName("퍼센트 인코딩된 비밀번호를 디코드한다")
    void decodesPercentEncodedPassword() {
        // alembic env.py 가 '%' 를 ConfigParser 때문에 이스케이프하는 것과 같은 부류의 함정이다.
        DatabaseUrl parsed = DatabaseUrl.parse("postgresql://u:p%40ss%25word@h:5432/db");

        assertThat(parsed.password()).isEqualTo("p@ss%word");
    }

    @Test
    @DisplayName("쿼리 파라미터(sslmode 등)를 JDBC URL 에 그대로 넘긴다")
    void keepsQueryParameters() {
        assertThat(DatabaseUrl.parse("postgresql://u:p@h:5432/db?sslmode=require").jdbcUrl())
                .isEqualTo("jdbc:postgresql://h:5432/db?sslmode=require");
    }

    @Test
    @DisplayName("이미 jdbc: 형식이면 그대로 둔다")
    void passesThroughJdbcUrl() {
        DatabaseUrl parsed = DatabaseUrl.parse("jdbc:postgresql://h:5432/db");

        assertThat(parsed.jdbcUrl()).isEqualTo("jdbc:postgresql://h:5432/db");
        assertThat(parsed.username()).isNull();
    }

    @Test
    @DisplayName("빈 값·다른 스킴·DB 이름 누락은 기동 시점에 실패한다")
    void rejectsBadInput() {
        assertThatThrownBy(() -> DatabaseUrl.parse("")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> DatabaseUrl.parse("mysql://u:p@h/db"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> DatabaseUrl.parse("postgresql://u:p@h:5432/"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @DisplayName("비밀번호 없이 사용자만 있으면 사용자만 채운다")
    void parsesUserWithoutPassword() {
        DatabaseUrl parsed = DatabaseUrl.parse("postgresql://acting@h/db");

        assertThat(parsed.username()).isEqualTo("acting");
        assertThat(parsed.password()).isNull();
        assertThat(parsed.jdbcUrl()).isEqualTo("jdbc:postgresql://h:5432/db");
    }

    @Test
    @DisplayName("null·URI 문법 오류·호스트 없음·스킴 없음은 이유를 담아 실패한다")
    void rejectsMalformedInputWithAReason() {
        assertThatThrownBy(() -> DatabaseUrl.parse(null)).hasMessage("DATABASE_URL is required");
        assertThatThrownBy(() -> DatabaseUrl.parse("postgresql://h:5432/my db"))
                .hasMessage("DATABASE_URL is not a valid URI");
        assertThatThrownBy(() -> DatabaseUrl.parse("postgresql:///db")).hasMessage("DATABASE_URL has no host");
        assertThatThrownBy(() -> DatabaseUrl.parse("localhost:5432/db"))
                .hasMessage("DATABASE_URL must start with postgresql:// or postgres:// (got: <none>)");
    }

    @Test
    @DisplayName("빈 쿼리스트링은 JDBC URL 에 물음표를 남기지 않는다")
    void dropsEmptyQuery() {
        assertThat(DatabaseUrl.parse("postgresql://u:p@h/db?").jdbcUrl()).isEqualTo("jdbc:postgresql://h:5432/db");
    }
}
