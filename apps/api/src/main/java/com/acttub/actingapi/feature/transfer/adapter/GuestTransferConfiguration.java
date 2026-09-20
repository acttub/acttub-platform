package com.acttub.actingapi.feature.transfer.adapter;

import java.time.Clock;

import com.acttub.actingapi.feature.auth.app.GuestAccounts;
import com.acttub.actingapi.feature.memory.app.MemoryOwnership;
import com.acttub.actingapi.feature.practice.app.PracticeOwnership;
import com.acttub.actingapi.feature.transfer.app.GuestTransferService;
import com.acttub.actingapi.feature.transfer.app.TransferCodeRepository;
import com.acttub.actingapi.feature.upload.app.UploadOwnership;
import com.acttub.actingapi.platform.ledger.OperationOwnership;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 코드 해시의 키는 {@code JWT_SECRET} 에서 용도를 못박아 뽑는다({@code SignupTokens} 와 같은 방식).
 * 코드가 10분만 살아서 비밀을 바꾸면 그 사이 받아 둔 코드만 다시 받으면 된다.
 */
@Configuration
class GuestTransferConfiguration {

    @Bean
    GuestTransferService guestTransferService(
            TransferCodeRepository codes,
            GuestAccounts guests,
            UploadOwnership uploads,
            PracticeOwnership practices,
            OperationOwnership operations,
            MemoryOwnership memories,
            Clock clock,
            @Value("${JWT_SECRET:}") String secret) {
        return new GuestTransferService(codes, guests, uploads, practices, operations, memories, clock, secret);
    }
}
