package com.acttub.actingapi.feature.community.domain;

import java.util.List;
import java.util.regex.Pattern;

/**
 * 게시판 글·댓글에 적힌 연락처(전화번호·메신저 아이디·오픈채팅 링크)를 찾는다(SOMA-873).
 *
 * <p>상대역 구하기·오디션 정보 글에서 연락처를 바로 주고받으면 신고·차단 밖에서 만남이 이어지고 사칭·스팸이
 * 그 길로 들어온다. 그래서 글과 댓글에는 연락처를 적지 못하게 한다.
 *
 * <p><b>보수적으로 잡는다.</b> 평범한 한국어 문장이 막히는 것이 연락처 하나가 새는 것보다 나쁘다. 그래서
 * 숫자만으로는 휴대전화 꼴(01x-xxxx-xxxx)만 보고, 메신저는 "카톡·인스타" 같은 이름 바로 뒤에 아이디처럼
 * 생긴 영문·숫자가 오거나 "카톡 아이디"처럼 아이디를 직접 가리킬 때만 잡는다. "카톡으로 얘기해요"처럼
 * 뒤에 한글이 오면 잡지 않는다. 전자우편은 이 검사 밖이다.
 */
public final class ContactInfo {
    private ContactInfo() {
    }

    private static final String KAKAO = "(?:카카오톡|카톡|카카오)";
    private static final String INSTAGRAM = "(?:인스타그램|인스타|instagram|insta)";
    private static final String TELEGRAM = "(?:텔레그램|telegram)";
    /** "아이디"·"id"·"계정" 표시와 뒤의 쌍점. 소유 수량자(*+·?+)로 써 되짚기가 없다 — 긴 공백에도 선형이다. */
    private static final String LABEL = "(?:\\s*+(?:아이디|id|계정)\\s*+[:：]?+)";
    /** 이름 뒤의 공백·쌍점·공백. */
    private static final String GAP = "\\s*+[:：]?+\\s*+";
    private static final int FLAGS = Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE;

    private static final List<Pattern> PATTERNS = List.of(
            // 휴대전화. 010-1234-5678, 01012345678, 010 1234 5678, 010.1234.5678, +82 10-1234-5678.
            Pattern.compile("(?<![0-9])(?:\\+?82[-\\s.]?0?|0)1[016789][-\\s.]?[0-9]{3,4}[-\\s.]?[0-9]{4}(?![0-9])"),
            // 오픈채팅·메신저 링크.
            Pattern.compile("(?:open|pf|qr)\\.kakao\\.com|instagram\\.com/|instagr\\.am/|t\\.me/", FLAGS),
            // "카톡 아이디", "카카오톡 id", "카톡id" — 값이 없어도 아이디를 주고받자는 말이다.
            Pattern.compile(KAKAO + "\\s*+(?:아이디|id)(?![a-z])", FLAGS),
            // "카톡 abc123", "카톡: abc", "카카오톡 @abc".
            Pattern.compile("(?:카카오톡|카톡)" + GAP + "@?+[A-Za-z][A-Za-z0-9._-]{2,}", FLAGS),
            // "인스타 @abc", "인스타그램: @abc", "insta @abc".
            Pattern.compile(INSTAGRAM + LABEL + "?+" + GAP + "@[A-Za-z0-9._]{2,}", FLAGS),
            // "인스타 아이디 abc", "인스타 id: abc".
            Pattern.compile(INSTAGRAM + LABEL + "\\s*+@?+[A-Za-z0-9._]{3,}", FLAGS),
            // "텔레그램 @abc", "텔레그램 아이디 abc".
            Pattern.compile(TELEGRAM + "(?:" + LABEL + "\\s*+@?+[A-Za-z0-9_]{3,}|" + GAP + "@[A-Za-z0-9_]{3,})", FLAGS));

    /** 하나라도 연락처로 보이면 참. null 은 거짓이다. */
    public static boolean contains(String text) {
        if (text == null || text.isEmpty()) {
            return false;
        }
        for (Pattern pattern : PATTERNS) {
            if (pattern.matcher(text).find()) {
                return true;
            }
        }
        return false;
    }
}
