package com.acttub.actingapi.feature.billing.adapter.mail;

import java.text.NumberFormat;
import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.Locale;

import com.acttub.actingapi.feature.billing.app.BillingMailer.PaidMail;
import com.acttub.actingapi.feature.billing.app.BillingRules;

/**
 * 웹 Pro 구독 메일 본문(SOMA-961). 2026-11-01 사용자가 고른 시안(구독 시작 메일)을 메일 클라이언트에서 깨지지 않게 표와 인라인
 * 스타일로 옮긴 것이다. 순서: Pro로 열린 것 → 결제 정보 → 구독 관리 → 해지·환불 → 사업자 정보. 값은 모두 HTML 이스케이프한다.
 */
public final class SubscriptionMailTemplate {
    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("yyyy.MM.dd");
    private static final DateTimeFormatter DAY_TIME = DateTimeFormatter.ofPattern("yyyy.MM.dd HH:mm");
    private static final DateTimeFormatter MONTH_DAY = DateTimeFormatter.ofPattern("M월 d일");
    private static final String BLUE = "#4880EE";
    private static final String FONT = "Pretendard,-apple-system,'Apple SD Gothic Neo','Noto Sans KR','Malgun Gothic',sans-serif";

    public record Rendered(String subject, String html, String text) {
    }

    private SubscriptionMailTemplate() {
    }

    public static Rendered render(PaidMail mail) {
        String won = NumberFormat.getIntegerInstance(Locale.KOREA).format(mail.amount()) + "원";
        String subject = (mail.first() ? "Pro 구독을 시작했어요" : "Pro 구독이 갱신됐어요") + " · " + won + " 결제 완료";
        String name = mail.name() == null || mail.name().isBlank() ? null : mail.name().strip();
        String headline = mail.first()
                ? (name == null ? "Pro를 시작했어요" : name + "님, Pro를 시작했어요")
                : (name == null ? "Pro 구독이 갱신됐어요" : name + "님, Pro 구독이 갱신됐어요");
        String lead = mail.first() ? "오늘부터 아래 기능을 제한 없이 쓸 수 있어요." : "이번 기간에도 아래 기능을 제한 없이 쓸 수 있어요.";
        LocalDate start = day(mail.periodStart());
        LocalDate next = day(mail.periodEnd());
        String period = (start == null ? "" : DAY.format(start)) + " ~ " + (next == null ? "" : DAY.format(next.minusDays(1)));
        String nextLine = next == null ? "" : DAY.format(next) + " · " + won;
        String preheader = next == null ? "언제든 해지할 수 있어요." : "다음 결제일은 " + MONTH_DAY.format(next) + "이에요. 언제든 해지할 수 있어요.";
        String card = card(mail.cardCompany(), mail.cardNumber());
        String paidAt = mail.paidAt() == null ? "" : DAY_TIME.format(mail.paidAt().atZone(BillingRules.SEOUL));
        BillingRules.Plan plan = mail.plan() == null ? BillingRules.Plan.MONTHLY : mail.plan();
        String every = plan == BillingRules.Plan.YEARLY ? "매년" : "매달";
        String autoRenew = "해지하지 않으면 " + every + " 결제일에 같은 카드로 자동 결제돼요.";

        String[][] rows = {
            {"상품", plan.orderName()},
            {"결제 금액", won + " (부가세 포함)"},
            {"결제 수단", card},
            {"결제 일시", paidAt},
            {"이용 기간", period},
            {"다음 결제일", nextLine},
            {"주문 번호", mail.orderId()},
        };
        StringBuilder table = new StringBuilder();
        for (String[] row : rows) {
            table.append("<tr><td style=\"padding:10px 0;border-bottom:1px solid #F2F4F6;font-size:14px;color:#6B7684;width:38%;\">")
                    .append(esc(row[0]))
                    .append("</td><td style=\"padding:10px 0;border-bottom:1px solid #F2F4F6;font-size:14px;color:#191F28;font-weight:500;text-align:right;\">")
                    .append(esc(row[1]))
                    .append("</td></tr>");
        }

        String perk = "<tr><td style=\"padding:6px 0;font-size:15px;line-height:1.6;color:#191F28;\">"
                + "<span style=\"display:inline-block;width:6px;height:6px;border-radius:3px;background:" + BLUE
                + ";vertical-align:middle;margin-right:10px;\"></span>%s</td></tr>";
        String perks = String.format(perk, "AI 연기 코칭 횟수 제한 없음, 상위 AI 모델로 코칭")
                + String.format(perk, "회차를 넘어 반복되는 버릇을 기억하는 코칭")
                + String.format(perk, "리딩 대본 개수 제한 없음");
        String link = "color:" + BLUE + ";text-decoration:none;";

        String html = "<!doctype html><html lang=\"ko\"><head><meta charset=\"utf-8\">"
                + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>" + esc(subject) + "</title></head>"
                + "<body style=\"margin:0;padding:0;background:#F2F4F6;\">"
                + "<div style=\"display:none;max-height:0;overflow:hidden;opacity:0;\">" + esc(preheader) + "</div>"
                + "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background:#F2F4F6;\"><tr><td align=\"center\" style=\"padding:28px 16px;\">"
                + "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:520px;background:#FFFFFF;border-radius:16px;font-family:" + FONT + ";color:#191F28;\">"
                + "<tr><td style=\"padding:32px 28px;\">"
                + "<div style=\"font-weight:800;font-size:17px;letter-spacing:-0.02em;margin-bottom:28px;\">Acttub</div>"
                + "<h1 style=\"font-size:22px;font-weight:700;letter-spacing:-0.02em;line-height:1.4;margin:0 0 8px;\">" + esc(headline) + "</h1>"
                + "<p style=\"font-size:15px;color:#4E5968;line-height:1.6;margin:0 0 20px;\">" + esc(lead) + "</p>"
                + "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin:0 0 28px;\">" + perks + "</table>"
                + "<p style=\"font-size:13px;font-weight:600;color:#8B95A1;margin:0 0 8px;\">결제 정보</p>"
                + "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin:0 0 24px;border-collapse:collapse;\">" + table + "</table>"
                + "<a href=\"https://acttub.com/account\" style=\"display:block;text-align:center;background:" + BLUE
                + ";color:#FFFFFF;text-decoration:none;font-weight:600;font-size:15px;padding:14px;border-radius:14px;margin:0 0 24px;\">구독 관리</a>"
                + "<ul style=\"font-size:13px;color:#4E5968;line-height:1.7;margin:0 0 24px;padding:0 0 0 16px;\">"
                + "<li style=\"margin-bottom:6px;\">" + autoRenew + " 해지는 <a href=\"https://acttub.com/account\" style=\"" + link
                + "\">내 계정</a>에서 바로 할 수 있고, 해지해도 이번 이용 기간이 끝날 때까지 Pro를 쓸 수 있어요.</li>"
                + "<li>유료 기능을 쓰지 않았다면 결제 후 7일 안에 전액 환불해요. 쓴 뒤에는 쓴 날짜만큼 빼고 환불해요. <a href=\"https://acttub.com/refund\" style=\""
                + link + "\">해지·환불 정책</a></li></ul>"
                + "<div style=\"font-size:11.5px;color:#8B95A1;line-height:1.75;border-top:1px solid #F2F4F6;padding-top:18px;\">"
                + "이 메일은 결제 내용을 알려 드리는 안내 메일이에요. 문의는 <a href=\"mailto:acttub0527@gmail.com\" style=\"" + link + "\">acttub0527@gmail.com</a>으로 보내 주세요.<br>"
                + "액터브(ACTTUB) · 대표자 최우영 · 사업자등록번호 796-11-03104 · 통신판매업 2026-서울동대문-1884<br>"
                + "서울특별시 동대문구 고산자로 505, 2층 가17호 · 010-9508-8855<br>"
                + "<a href=\"https://acttub.com/terms\" style=\"" + link + "\">이용약관</a> · <a href=\"https://acttub.com/privacy\" style=\"" + link + "\">개인정보 처리방침</a>"
                + "</div></td></tr></table></td></tr></table></body></html>";

        String text = headline + "\n" + lead + "\n\n"
                + "- AI 연기 코칭 횟수 제한 없음, 상위 AI 모델로 코칭\n- 회차를 넘어 반복되는 버릇을 기억하는 코칭\n- 리딩 대본 개수 제한 없음\n\n"
                + "[결제 정보]\n" + rowsText(rows) + "\n"
                + "구독 관리: https://acttub.com/account\n\n"
                + autoRenew + " 해지는 내 계정에서 바로 할 수 있고, 해지해도 이번 이용 기간이 끝날 때까지 Pro를 쓸 수 있어요.\n"
                + "유료 기능을 쓰지 않았다면 결제 후 7일 안에 전액 환불해요. 쓴 뒤에는 쓴 날짜만큼 빼고 환불해요. 해지·환불 정책: https://acttub.com/refund\n\n"
                + "문의: acttub0527@gmail.com\n"
                + "액터브(ACTTUB) · 대표자 최우영 · 사업자등록번호 796-11-03104 · 통신판매업 2026-서울동대문-1884\n"
                + "서울특별시 동대문구 고산자로 505, 2층 가17호 · 010-9508-8855\n"
                + "이용약관 https://acttub.com/terms · 개인정보 처리방침 https://acttub.com/privacy\n";
        return new Rendered(subject, html, text);
    }

    static String card(String company, String number) {
        String last = number == null ? "" : number.strip();
        last = last.length() > 4 ? last.substring(last.length() - 4) : last;
        String name = company == null || company.isBlank() ? "카드" : company.strip() + (company.strip().endsWith("카드") ? "" : "카드");
        return last.isEmpty() ? name : name + " ····" + last;
    }

    private static String rowsText(String[][] rows) {
        StringBuilder out = new StringBuilder();
        for (String[] row : rows) {
            out.append(row[0]).append(": ").append(row[1]).append('\n');
        }
        return out.toString();
    }

    private static LocalDate day(Instant instant) {
        return instant == null ? null : instant.atZone(BillingRules.SEOUL).toLocalDate();
    }

    static String esc(String value) {
        if (value == null) {
            return "";
        }
        StringBuilder out = new StringBuilder(value.length());
        for (char c : value.toCharArray()) {
            switch (c) {
                case '&' -> out.append("&amp;");
                case '<' -> out.append("&lt;");
                case '>' -> out.append("&gt;");
                case '"' -> out.append("&quot;");
                case '\'' -> out.append("&#39;");
                default -> out.append(c);
            }
        }
        return out.toString();
    }
}
