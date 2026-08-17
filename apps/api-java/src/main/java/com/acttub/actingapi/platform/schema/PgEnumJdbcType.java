package com.acttub.actingapi.platform.schema;

import java.sql.CallableStatement;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Types;

import org.hibernate.type.SqlTypes;
import org.hibernate.type.descriptor.ValueBinder;
import org.hibernate.type.descriptor.ValueExtractor;
import org.hibernate.type.descriptor.WrapperOptions;
import org.hibernate.type.descriptor.java.JavaType;
import org.hibernate.type.descriptor.jdbc.BasicBinder;
import org.hibernate.type.descriptor.jdbc.BasicExtractor;
import org.hibernate.type.descriptor.jdbc.JdbcType;

/**
 * 네이티브 Postgres enum 컬럼에 <b>문자열</b>을 안전하게 바인딩한다.
 *
 * <p>왜 필요한가. {@code @Enumerated} 는 못 쓰고({@link PgEnum} 참고)
 * {@link jakarta.persistence.AttributeConverter} 로 String 을 내보내는데,
 * 드라이버가 그것을 {@code varchar} 로 보내면 Postgres 가
 * {@code operator does not exist: user_status_t = character varying} 로 거절한다.
 * {@code setObject(…, Types.OTHER)} 로 <b>타입 없는 값</b>으로 보내면 서버가 컬럼 타입으로 추론한다.
 *
 * <p>왜 {@code @JdbcTypeCode(SqlTypes.NAMED_ENUM)} 이 아닌가. M0 에서 실제로 시도했고
 * {@code entityManagerFactory} 생성이 {@code Cannot read the array length because "values" is null}
 * 로 죽었다. Hibernate 의 {@code PostgreSQLEnumJdbcType} 은 Java 타입이 <i>enum</i> 이라고 가정하고
 * {@code getEnumConstants()} 를 부르는데, 컨버터를 거치면 관계 타입이 {@code String} 이라 null 이 나온다.
 * 즉 NAMED_ENUM 과 AttributeConverter 는 <b>같이 쓸 수 없다</b>. (M0-findings.md 에 기록)
 *
 * <p>대안이던 JDBC URL 의 {@code stringtype=unspecified} 는 커넥션 전체의 바인딩 의미를 바꾸므로
 * 쓰지 않는다 — 문제 컬럼만 정확히 겨냥하는 이쪽이 부작용이 없다.
 */
public class PgEnumJdbcType implements JdbcType {

    public static final PgEnumJdbcType INSTANCE = new PgEnumJdbcType();

    @Override
    public int getJdbcTypeCode() {
        return SqlTypes.OTHER;
    }

    @Override
    public <X> ValueBinder<X> getBinder(JavaType<X> javaType) {
        return new BasicBinder<>(javaType, this) {
            @Override
            protected void doBind(PreparedStatement st, X value, int index, WrapperOptions options)
                    throws SQLException {
                st.setObject(index, javaType.unwrap(value, String.class, options), Types.OTHER);
            }

            @Override
            protected void doBind(CallableStatement st, X value, String name, WrapperOptions options)
                    throws SQLException {
                st.setObject(name, javaType.unwrap(value, String.class, options), Types.OTHER);
            }
        };
    }

    @Override
    public <X> ValueExtractor<X> getExtractor(JavaType<X> javaType) {
        return new BasicExtractor<>(javaType, this) {
            @Override
            protected X doExtract(ResultSet rs, int paramIndex, WrapperOptions options)
                    throws SQLException {
                return javaType.wrap(rs.getString(paramIndex), options);
            }

            @Override
            protected X doExtract(CallableStatement statement, int index, WrapperOptions options)
                    throws SQLException {
                return javaType.wrap(statement.getString(index), options);
            }

            @Override
            protected X doExtract(CallableStatement statement, String name, WrapperOptions options)
                    throws SQLException {
                return javaType.wrap(statement.getString(name), options);
            }
        };
    }
}
