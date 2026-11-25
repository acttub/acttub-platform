package com.acttub.actingapi.feature.profile.lifecycle;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.hibernate.resource.jdbc.spi.StatementInspector;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.transaction.TransactionExecution;
import org.springframework.transaction.TransactionExecutionListener;

/**
 * 이 스레드가 보낸 SQL 과 트랜잭션의 시작·끝을 차례대로 모은다. 계정 수명 일이 내는 문장의 종류와 차례, 잠금을 잡는 차례,
 * 한 트랜잭션에 든 범위를 기준 파일과 견주려고 쓴다.
 *
 * <p>문장은 {@code <종류> <쓰는 표> (읽는 표) <잠금>} 으로 줄인다. 별칭·열 목록·매개변수 표기는 네이티브 SQL 과 JPQL 이 달라
 * 견주지 않는다. 다른 스레드(배경 작업)의 문장은 섞이지 않는다.
 *
 * <p>{@code spring.jpa.properties.hibernate.session_factory.statement_inspector} 에 이 클래스 이름을 주고
 * {@link Transactions} 를 {@code @Import} 한다.
 */
public final class StatementTrace implements StatementInspector {

    private static final ThreadLocal<List<String>> EVENTS = new ThreadLocal<>();

    /** 잠금 절({@code for update}, {@code for no key update})과 {@code on conflict do update} 의 update 는 쓰는 문장이 아니다. */
    private static final Pattern WRITE =
            Pattern.compile("\\b(insert into|(?<!for )(?<!no key )(?<!do )update|delete from)\\s+(\\w+)");
    private static final Pattern READ = Pattern.compile("\\b(from|join|using)\\s+(\\w+)");
    private static final Pattern LOCK = Pattern.compile("\\bfor (no key update|update|key share|share)\\b");

    /** 이 스레드의 기록을 시작한다. */
    static void start() {
        EVENTS.set(new ArrayList<>());
    }

    /**
     * 기록을 끝내고 모은 것을 돌려준다.
     *
     * <p>같은 문장으로 시작하는 트랜잭션이 이어지면 그 묶음 안에서는 내용 순으로 늘어놓는다. 정리 장부의 일은 무작위 id 순으로
     * 집혀, 일마다 여는 트랜잭션의 차례가 실행마다 다르다. 트랜잭션 안의 문장 차례와 다른 트랜잭션과의 앞뒤는 그대로다.
     */
    static List<String> stop() {
        List<String> events = EVENTS.get();
        EVENTS.remove();
        List<List<String>> units = new ArrayList<>();
        List<String> open = null;
        for (String event : events) {
            if ("BEGIN".equals(event)) {
                open = new ArrayList<>();
                units.add(open);
            }
            if (open == null) {
                units.add(List.of(event));
            } else {
                open.add(event);
                if (!event.startsWith(" ") && !"BEGIN".equals(event)) {
                    open = null;
                }
            }
        }
        List<String> ordered = new ArrayList<>();
        for (int start = 0; start < units.size();) {
            int end = start + 1;
            while (end < units.size() && sameOpening(units.get(start), units.get(end))) {
                end++;
            }
            units.subList(start, end).stream().map(unit -> String.join("\n", unit)).sorted()
                    .forEach(unit -> ordered.addAll(List.of(unit.split("\n"))));
            start = end;
        }
        return ordered;
    }

    private static boolean sameOpening(List<String> one, List<String> other) {
        return one.size() > 1 && other.size() > 1 && "BEGIN".equals(one.getFirst()) && one.get(1).equals(other.get(1));
    }

    @Override
    public String inspect(String sql) {
        List<String> events = EVENTS.get();
        if (events != null) {
            events.add("  " + label(sql));
        }
        return sql;
    }

    /** 문장을 「종류, 쓰는 표, 읽는 표, 잠금」 으로 줄인다. */
    static String label(String sql) {
        String text = sql.strip().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
        List<String> writes = new ArrayList<>();
        Set<String> written = new LinkedHashSet<>();
        Matcher write = WRITE.matcher(text);
        while (write.find()) {
            writes.add(write.group(1).split(" ")[0] + " " + write.group(2));
            written.add(write.group(2));
        }
        Set<String> read = new LinkedHashSet<>();
        Matcher from = READ.matcher(text);
        while (from.find()) {
            // 서브쿼리와 CTE 의 이름(괄호, 문장 안에서 지은 이름)은 표가 아니다.
            if (!written.contains(from.group(2)) && !text.contains(from.group(2) + " as (") && !"lateral".equals(from.group(2))) {
                read.add(from.group(2));
            }
        }
        if (writes.isEmpty() && read.isEmpty()) {
            // 표를 읽지 않는 문장(설정 바꾸기 등)은 앞머리를 그대로 적는다.
            return text.length() <= 60 ? text : text.substring(0, 60);
        }
        StringBuilder label = new StringBuilder(writes.isEmpty() ? "select " + String.join(", ", read) : String.join(" + ", writes));
        if (!writes.isEmpty() && !read.isEmpty()) {
            label.append(" (읽기 ").append(String.join(", ", read)).append(')');
        }
        if (text.contains(" on conflict")) {
            label.append(" on conflict");
        }
        if (text.contains(" returning ")) {
            label.append(" returning");
        }
        Matcher lock = LOCK.matcher(text);
        if (lock.find()) {
            label.append(" for ").append(lock.group(1));
        }
        if (text.contains(" skip locked")) {
            label.append(" skip locked");
        }
        return label.toString();
    }

    /** 트랜잭션이 실제로 시작하고 끝난 자리를 기록에 끼운다. 이미 열린 트랜잭션에 얹힌 호출은 적지 않는다. */
    @TestConfiguration(proxyBeanMethods = false)
    static class Transactions {
        @Bean
        TransactionExecutionListener statementTraceTransactions() {
            return new TransactionExecutionListener() {
                @Override
                public void afterBegin(TransactionExecution transaction, Throwable beginFailure) {
                    mark("BEGIN");
                }

                @Override
                public void afterCommit(TransactionExecution transaction, Throwable commitFailure) {
                    mark(commitFailure == null ? "COMMIT" : "COMMIT 실패");
                }

                @Override
                public void afterRollback(TransactionExecution transaction, Throwable rollbackFailure) {
                    mark("ROLLBACK");
                }
            };
        }

        private static void mark(String event) {
            List<String> events = EVENTS.get();
            if (events != null) {
                events.add(event);
            }
        }
    }
}
