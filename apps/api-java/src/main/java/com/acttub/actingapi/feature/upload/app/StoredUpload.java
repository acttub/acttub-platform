package com.acttub.actingapi.feature.upload.app;

/**
 * 스토리지에 실제로 올라와 있는 것. 의도에 적힌 약속과 대조하는 데 필요한 만큼만 담는다.
 */
public record StoredUpload(long sizeBytes, String etag) {
}
