package com.acttub.actingapi.community.domain;

/** 글이 속하는 분류. 목록은 운영이 정하며 코드가 만들지 않는다. */
public record CommunityCategory(String slug, String name, String description) {
}
