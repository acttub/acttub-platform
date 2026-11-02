package com.acttub.actingapi.feature.community.domain;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/** 게시판 연락처 막기(SOMA-873). 잡아야 할 꼴과, 평범한 문장이 막히지 않는 것을 함께 본다. */
class ContactInfoTest {

    @ParameterizedTest
    @ValueSource(strings = {
        "010-1234-5678",
        "연락은 01012345678 로 주세요",
        "010 1234 5678",
        "010.1234.5678",
        "011-123-4567",
        "+82 10-1234-5678",
        "+821012345678",
        "카톡 abc",
        "카톡 abc123 으로 연락 주세요",
        "카톡: acting_kim",
        "카톡아이디 남겨 주세요",
        "카카오톡 id",
        "카카오톡 ID: abc",
        "카카오 아이디 알려주세요",
        "카카오톡 @abc",
        "https://open.kakao.com/o/sAbCdEf",
        "오픈채팅 open.kakao.com/o/xyz",
        "인스타 @acting_me",
        "인스타그램: @acting.me",
        "insta @abc",
        "Instagram @abc",
        "인스타 아이디 acting_me",
        "instagram.com/acting_me",
        "텔레그램 @abcd",
        "t.me/abcd",
    })
    void catchesPhoneNumbersAndMessengerIds(String text) {
        assertThat(ContactInfo.contains(text)).as(text).isTrue();
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "",
        "카톡으로 얘기해요",
        "카톡 보내 주세요",
        "카카오톡 프로필 사진 바꿨어요",
        "카카오 T 타고 갔어요",
        "인스타 보고 왔어요",
        "인스타에 올린 영상 봐 주세요",
        "인스타그램 릴스 어떻게 찍어요?",
        "오디션은 2026-1234-5678 접수번호로 확인",
        "3시 10분에 1234번 버스",
        "독백 1분 30초, 2024년 10월 12일 공연",
        "010호 연습실에서 만나요",
        "대사 10개 중에 7개 외웠어요",
        "@멘션은 괜찮아요",
        "이메일 대신 쪽지 주세요",
        "id 카드 챙기세요",
    })
    void letsOrdinarySentencesThrough(String text) {
        assertThat(ContactInfo.contains(text)).as(text).isFalse();
    }

    @org.junit.jupiter.api.Test
    void nullIsNotContactInfo() {
        assertThat(ContactInfo.contains(null)).isFalse();
    }
}
