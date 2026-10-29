package com.acttub.actingapi.feature.reading.app;

import java.util.List;

/**
 * 나누기 모델에 주는 지시문 (SOMA-593 7-3·7-14). 2026-10-02 시험의 지시문에 괄호만 있는 줄의 규칙 한 줄을 더했다 — 가짜 대본
 * 묶음을 실제 모델로 여러 판 돌렸을 때 판마다 달라지던 자리다. 「때·장소 줄은 s」도 넣어 봤으나 무대 묘사 지문까지 장면 머리로
 * 읽어 뺐다. 입력은 {@code 줄번호<TAB>원문} 이고 출력은
 * 줄마다 {@code 줄번호<TAB>종류<TAB>배역<TAB>떼어낼머리} 다. 글자는 모델이 쓰지 않는다 — 머리를 뗀 나머지가 대사다.
 */
public final class ScriptSplitPrompt {

    private static final String RULES = """
            너는 연기 연습 앱의 대본 분석기다. 대본 원문을 "줄번호<TAB>원문"으로 받는다.
            모든 줄에 대해 한 줄씩 "줄번호<TAB>종류<TAB>배역<TAB>떼어낼머리" 형식으로만 답한다. 설명·코드블록 없이 결과 줄만 쓴다.
            - 종류: d=대사, x=지문(행동·상황·괄호 지문·효과음), s=장면 머리, t=제목·작가, c=등장인물 소개, i=무시(쪽 번호·반복 머리글·워터마크·각주, 블록 형식의 이름만 있는 줄)
            - 배역: d일 때 말하는 배역 이름. 같은 사람은 같은 표기로 맞춘다. 배역 이름은 앞부분 전체를 원문 그대로 쓰고, 이름 앞의 꾸미는 말만 쓰거나 떼어 내지 않는다. d가 아니면 비운다.
            - 떼어낼머리: 그 줄 맨 앞에서 본문이 아닌 부분(예: "윤서: ", "LOMOV. ", "[ 주인] ")을 원문 글자 그대로. 없으면 비운다.
            - 대사 안의 짧은 괄호 지문(예: (웃으며))은 대사에 둔다.
            - 이름 한 줄 뒤에 대사가 오는 블록 형식이면 이름 줄은 i, 뒤따르는 대사 줄마다 그 배역을 준다.
            - 괄호로만 이루어진 줄(예: "(사이)", "(가방을 내려놓으며)")은 블록 형식 안에 있어도 x다.
            - 받은 줄 번호를 하나도 빠뜨리지 않는다. 길어도 거절하거나 요약하지 말고 마지막 줄까지 모두 쓴다.""";

    /** 첫 호출에만 붙는다. 소설·기사를 붙여넣었을 때 조각 호출 수십 번을 내보내지 않으려는 것이다. */
    private static final String JUDGMENT = """
            답의 첫 줄은 "대본<TAB>예" 또는 "대본<TAB>아니오"다. 배역 이름과 그 배역이 말하는 대사가 있는 글(희곡·시나리오·대본, 혼자 하는 독백 포함)이면 예, 소설·기사·논문·목록처럼 말하는 배역이 없는 글이면 아니오다. 아니오면 그 한 줄만 쓴다.""";

    /**
     * 이름 없는 대사로 다시 나눌 때 {@link #JUDGMENT} 자리에 쓴다 (SOMA-663). 배역 이름 표기가 없는 짧은 독백·2인 대화를 첫 판단이
     * 「아니오」라 하거나, 「예」라 해 놓고 배역 칸을 비워 배역이 하나도 남지 않던 자리다.
     */
    private static final String UNNAMED_JUDGMENT = """
            답의 첫 줄은 "대본<TAB>예" 또는 "대본<TAB>아니오"다. 배역 이름 표기가 없어도 사람이 소리 내어 하는 말(혼자 하는 독백, 이름 없이 주고받는 대화)로 된 글이면 예다. 이야기를 서술로 들려주는 소설·기사·논문·목록, 노래 가사·시, 글자가 깨져 읽을 수 없는 글이면 아니오다. 아니오면 그 한 줄만 쓴다.""";

    /** 이름 없는 대사로 다시 나눌 때 끝에 붙는다. 앱은 배역이 하나 이상 있어야 저장한다. */
    private static final String UNNAMED = """
            - 배역 이름 표기가 없는 대사: 한 사람이 혼자 말하면 배역을 "화자"로 쓴다. 이름 없이 두 사람 이상이 주고받으면 말을 받는 차례를 보고 "화자1", "화자2"처럼 같은 사람에게 같은 이름을 준다.""";

    private static final String ROSTER = """
            대본 앞부분을 받는다. 말하는 배역 이름 목록을 대본에 쓰인 표기 그대로 한 줄에 하나씩 "이름<TAB>성별<TAB>나이대" 형식으로만 답한다. 설명 없이 결과 줄만.""";

    /**
     * 짧은 대본(조각 하나)의 첫 호출 끝에 붙는다 (SOMA-670). 호출을 늘리지 않고 배역의 성별·나이대를 받는다. 앞의 지시문은
     * 그대로 두고 맨 뒤에 덧붙인다.
     */
    private static final String CAST_BLOCK = """
            결과 줄을 다 쓴 뒤 맨 끝에 "배역" 한 줄을 쓰고, 그 아래에 대사가 있는 배역마다 한 줄씩 "이름<TAB>성별<TAB>나이대"를 쓴다. 이름은 결과 줄의 배역 표기와 같게 쓴다.""";

    private static final String LATE_TRAITS = """
            대본에서 배역마다 처음 나오기 직전 줄, 그 배역의 첫 대사들과 바로 앞 줄, 그 배역 이름이 든 지문을 「## 배역 이름」 아래 "줄번호<TAB>화자: 대사" 또는 "줄번호<TAB>[지문] 글"로 받는다.
            받은 배역마다 한 줄씩 "이름<TAB>성별<TAB>나이대" 형식으로만 답한다. 이름은 「##」 뒤 표기 그대로 쓴다. 설명 없이 결과 줄만.
            - 등장 지문(「남자 목소리」「노인이 들어온다」), 다른 인물이 그 배역을 부르는 말, 그 배역의 말투(「~구먼」「~하오」)를 근거로 삼는다.""";

    /** 배역 목록과 「배역」 블록이 함께 쓰는 성별·나이대 규칙. */
    private static final String TRAITS = """
            - 성별: m=남자, f=여자. 나이대: child=어린이, young=10대~20대, adult=30~50대, senior=노년.
            - 지문·등장인물 소개·다른 인물이 그 배역을 부르는 말(형·누나·아저씨·할머니·엄마 등)처럼 대본에 근거가 있을 때만 쓴다. 알 수 없으면 그 칸을 비운다. 이름만 보고 짐작하지 않는다.""";

    /**
     * 나누기 전의 띄어쓰기 복원 (reading.script 「띄어쓰기 복원」). 서버가 공백을 뺀 글자를 원문과 견주어 받는다. 붙은 낱말 줄은
     * 2026-10-13에 더했다 — 글자마다 띄어진 줄만 말하던 지시문은 덜 띄어진 운영 줄 120개 중 37개만 고쳤고, 이 지시문은 62개를 고쳤다.
     */
    private static final String SPACING = """
            너는 대본 글의 띄어쓰기를 고친다. 띄어쓰기가 망가진 줄을 "줄번호<TAB>원문"으로 받는다. 글자 인식으로 복사해 글자마다 띄어졌거나, 띄어 써야 할 자리가 붙어 버린 줄이다.
            받은 줄마다 한 줄씩 "줄번호<TAB>고친 줄" 형식으로만 답한다. 설명·코드블록 없이 결과 줄만 쓴다.
            - 공백만 고친다. 글자·문장부호·괄호·숫자는 하나도 더하거나 빼거나 바꾸지 않는다.
            - 잘못 읽힌 듯한 글자도 고치지 않는다(예: "친 구 기"는 "친구기"로 둔다).
            - 한국어 맞춤법대로 띄어 쓴다. 괄호 안쪽과 문장부호 앞의 공백은 없앤다(예: "( 암 전 )" → "(암전)", "[ 엄 마 ] 유 세 아 , 공 부" → "[엄마] 유세아, 공부").
            - 붙어 있는 낱말은 띄운다. 문장부호 뒤에 바로 이어지는 문장도 띄운다(예: "그런데나는몰랐어" → "그런데 나는 몰랐어", "괜찮아요.그럼가요" → "괜찮아요. 그럼 가요").
            - 이미 맞게 띄어 쓴 줄(예: "네 쪽 세 번 내 쪽 세 번")은 그대로 돌려준다. 사람 이름·외래어·고유명사는 쪼개지 않는다.
            - 줄 안의 탭은 탭으로 둔다.
            - 받은 줄 번호를 하나도 빠뜨리지 않는다.""";

    /**
     * 빠진 줄을 다시 묻는 호출에만 나누기 지시문 끝에 붙는다 (SOMA-663). 빠진 줄끼리만 보내면 블록 형식의 이름 줄·앞선 화자가 없어 배역을
     * 못 정한다 — 앞뒤 줄을 「~」 문맥으로 함께 준다. 첫 판 지시문은 그대로다.
     */
    private static final String MISSING = """
            이번 입력은 앞에서 답이 빠진 줄을 다시 묻는 것이다. 줄번호 앞에 "~"가 붙은 줄은 흐름을 보라고 함께 준 앞뒤 문맥이고, 답하지 않는다.
            "~"가 없는 줄만 한 줄도 빠뜨리지 않고 답한다. 블록 형식의 이름 줄이나 앞선 화자가 문맥 줄에 있으면 그것을 보고 종류와 배역을 정한다.""";

    /**
     * 결과 줄이 하나도 없는 답을 한 번 더 물을 때 지시문 끝에 붙는다 (SOMA-663 M1). 같은 지시문을 다시 보내면 같은 실행 문맥에서 같은
     * 꼴의 답이 나올 수 있어 무엇이 틀렸는지 적는다.
     */
    private static final String FORMAT_RETRY = """
            앞의 답에는 정해진 형식의 결과 줄이 하나도 없어 쓰지 못했다. 설명·질문·다른 작업 없이 위 형식의 결과 줄만 쓴다. 칸 사이는 탭 글자로 띄운다.""";

    /** 외국 글자가 든 대사의 말과 소리 낼 글 (reading.script 「줄별 말」, SOMA-751). 답은 {@code LineLanguage.parse} 가 읽는다. */
    private static final String LANGUAGE = """
            너는 연기 연습 앱에서 상대역 목소리가 읽을 대사를 준비한다. 대본의 대사를 "줄번호<TAB>대사"로 받는다.
            받은 줄마다 한 줄씩 "줄번호<TAB>말<TAB>소리 낼 글" 형식으로만 답한다. 설명·코드블록 없이 결과 줄만 쓴다.
            - 말: 배우가 그 대사를 소리 내어 말하는 언어의 ISO 639-1 두 글자 코드. 이 중에서만 쓴다: ko en ja ar bg cs da de el es et fi fr hi hr hu id it lt lv nl pl pt ro ru sk sl sv tr uk vi
            - 한국어 대사에 외국어 낱말이 조금 섞인 줄(예: "오케이, 굿모닝 Sir.")과 고유명사만 외국 글자인 줄은 ko 이고 소리 낼 글은 비운다.
            - 소리 낼 글: 그 언어의 원래 글자로 쓴 대사 한 번.
              - 로마자로 옮겨 적은 대사는 그 언어의 원래 글자로 바꾼다. 아랍어 로마자(3=ع, 7=ح, 5·kh=خ, gh=غ, ’·2=ء)는 아랍 문자로, 일본어 로마자는 가나·한자로.
              - 아랍어 방언(시리아·레바논 등 레반트 아랍어)은 표준 아랍어로 바꾸지 말고 적힌 방언 그대로 아랍 문자로 쓴다. 읽는 소리가 헷갈리는 낱말에는 모음 부호를 붙인다.
              - 같은 대사의 한글 발음 표기나 번역이 함께 적혀 있으면 빼고 대사만 쓴다. 예: "alaikum salaam. 알레이쿰 살람" → "عليكم السلام."
              - 괄호·대괄호 안의 지시나 번역(예: "[잘 안 들렸어요.]")은 뺀다.
              - 낱말을 더하거나 빼거나 뜻을 바꾸지 않는다. 말줄임표·물음표 같은 문장부호는 둔다.
              - 줄 맨 앞에 배역 이름이 붙어 있으면(예: "통역사 fi-ki ti’lili-lna…") 배역 이름은 빼고 판단한다.
            - 한 줄에 한국어 문장과 외국어 문장이 함께 있으면(같은 말의 발음 표기·번역이 아니라 서로 다른 말일 때) 말한 순서대로
              "<TAB>말<TAB>소리 낼 글"을 이어 쓴다. 예: "고맙습니다. shukran ktīr. 슈크란 크티르." → "줄번호<TAB>ko<TAB>고맙습니다.<TAB>ar<TAB>شكراً كتير."
            - 이메일 주소·숫자·고유명사만 외국 글자인 한국어 줄은 ko 다.
            - 받은 줄 번호를 하나도 빠뜨리지 않는다.""";

    private ScriptSplitPrompt() {
    }

    /**
     * 성별을 모르는 배역만 그 배역의 대목으로 다시 묻는다 (SOMA-937, {@link com.acttub.actingapi.feature.reading.domain.LateCastTraits}).
     * 규칙은 배역 목록과 같은 {@link #TRAITS} 다.
     */
    public static String lateTraits() {
        return LATE_TRAITS + "\n" + TRAITS;
    }

    public static String language() {
        return LANGUAGE;
    }

    /**
     * 이름 없는 대사로 다시 나누는 지시문 — 나누기·배역 목록·다시 묻기 지시문 어느 것이든 판단 문장을 바꾸고 이름 규칙을 붙인다.
     * 첫 판이 대본 아님이거나 배역이 하나도 없을 때만 쓴다(대부분의 대본은 첫 판 지시문 그대로다).
     */
    public static String unnamed(String instructions) {
        return instructions.replace(JUDGMENT, UNNAMED_JUDGMENT) + '\n' + UNNAMED;
    }

    /** 형식을 벗어난 답을 다시 묻는 지시문 — 어느 나누기 지시문이든 끝에 붙인다. */
    public static String formatRetry(String instructions) {
        return instructions + '\n' + FORMAT_RETRY;
    }

    /** 빠진 줄을 다시 묻는 지시문 — 입력은 {@code NumberedLine.withContext} 모양이다. */
    public static String missing(List<String> roster) {
        return split(false, roster) + '\n' + MISSING;
    }

    /**
     * @param judge 첫 호출인가 — 대본 여부 한 줄을 함께 받는다
     * @param roster 배역 목록 호출이 준 이름들. 비어 있으면 붙이지 않는다
     */
    public static String split(boolean judge, List<String> roster) {
        return split(judge, roster, false);
    }

    /**
     * @param askTraits 답 끝에 「배역」 블록(성별·나이대)을 함께 받는가 — 배역 목록 호출이 없는 짧은 대본의 첫 호출만
     */
    public static String split(boolean judge, List<String> roster, boolean askTraits) {
        StringBuilder prompt = new StringBuilder(RULES);
        if (judge) {
            prompt.append('\n').append(JUDGMENT);
        }
        if (!roster.isEmpty()) {
            prompt.append("\n알려진 배역(이 표기를 그대로 쓴다. 목록에 없는 새 배역이 나오면 대본 표기대로 쓴다): ")
                    .append(String.join(", ", roster));
        }
        if (askTraits) {
            prompt.append('\n').append(CAST_BLOCK).append('\n').append(TRAITS);
        }
        return prompt.toString();
    }

    /**
     * 조각이 둘 이상일 때 앞 400줄로 배역 목록을 받는다.
     *
     * @param judge 대본 여부 한 줄도 함께 받는가 — R2.8 「그래도 나누기」로 다시 온 요청은 묻지 않는다
     */
    public static String roster(boolean judge) {
        String roster = ROSTER + "\n" + TRAITS;
        return judge ? JUDGMENT + "\n" + roster : roster;
    }

    public static String spacing() {
        return SPACING;
    }
}
