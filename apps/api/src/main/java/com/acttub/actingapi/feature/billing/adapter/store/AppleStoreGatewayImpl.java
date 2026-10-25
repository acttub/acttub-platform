package com.acttub.actingapi.feature.billing.adapter.store;

import java.io.InputStream;
import java.time.Instant;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import com.acttub.actingapi.feature.billing.app.StoreGateways.AppleNotification;
import com.acttub.actingapi.feature.billing.app.StoreGateways.AppleStoreGateway;
import com.acttub.actingapi.feature.billing.app.StoreGateways.AppleTransaction;
import com.acttub.actingapi.feature.billing.app.StoreGateways.StoreException;
import com.apple.itunes.storekit.client.APIException;
import com.apple.itunes.storekit.client.AppStoreServerAPIClient;
import com.apple.itunes.storekit.model.AutoRenewStatus;
import com.apple.itunes.storekit.model.Environment;
import com.apple.itunes.storekit.model.JWSRenewalInfoDecodedPayload;
import com.apple.itunes.storekit.model.JWSTransactionDecodedPayload;
import com.apple.itunes.storekit.model.LastTransactionsItem;
import com.apple.itunes.storekit.model.ResponseBodyV2DecodedPayload;
import com.apple.itunes.storekit.model.StatusResponse;
import com.apple.itunes.storekit.model.SubscriptionGroupIdentifierItem;
import com.apple.itunes.storekit.verification.SignedDataVerifier;
import com.apple.itunes.storekit.verification.VerificationException;
import com.apple.itunes.storekit.verification.VerificationStatus;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Apple 공식 app-store-server-library 로 거래·알림 JWS 를 검증한다(SOMA-818 2단계). 서명 체인은 리소스로 둔 Apple Root CA G3 까지,
 * 번들 ID 는 설정값과, 운영 환경은 앱 Apple ID 와 맞는지 라이브러리가 확인한다. 운영(Production)으로 검증해 보고 환경이 다르면
 * 샌드박스로 다시 검증한다 — 심사·TestFlight 구매가 샌드박스로 오기 때문이다.
 *
 * <p>.p8 키·keyId·issuerId 는 선택이다. 있으면 App Store Server API 로 최신 갱신 정보를 묻고, 없으면 JWS 만으로 판단한다.
 * 비밀 값은 로그·예외에 싣지 않는다.
 */
public class AppleStoreGatewayImpl implements AppleStoreGateway {
    private static final Logger LOG = LoggerFactory.getLogger(AppleStoreGatewayImpl.class);

    private final SignedDataVerifier production;
    private final SignedDataVerifier sandbox;
    private final AppStoreServerAPIClient productionClient;
    private final AppStoreServerAPIClient sandboxClient;

    /**
     * @param appAppleId 운영 환경 검증에 필요한 앱 Apple ID(null 이면 운영 검증을 쓰지 않는다)
     * @param privateKeyP8 App Store Connect API 키(.p8 PEM). 비어 있으면 API 조회를 쓰지 않는다
     */
    public AppleStoreGatewayImpl(String bundleId, Long appAppleId, boolean onlineChecks, String privateKeyP8, String keyId,
            String issuerId) {
        this(loadRoots(), bundleId, appAppleId, onlineChecks, privateKeyP8, keyId, issuerId);
    }

    AppleStoreGatewayImpl(Set<InputStream> roots, String bundleId, Long appAppleId, boolean onlineChecks,
            String privateKeyP8, String keyId, String issuerId) {
        this.sandbox = new SignedDataVerifier(roots, bundleId, appAppleId, Environment.SANDBOX, onlineChecks);
        this.production = appAppleId == null ? null
                : new SignedDataVerifier(loadRoots(), bundleId, appAppleId, Environment.PRODUCTION, onlineChecks);
        boolean api = privateKeyP8 != null && !privateKeyP8.isBlank() && keyId != null && !keyId.isBlank()
                && issuerId != null && !issuerId.isBlank();
        this.productionClient = api ? new AppStoreServerAPIClient(privateKeyP8, keyId, issuerId, bundleId, Environment.PRODUCTION) : null;
        this.sandboxClient = api ? new AppStoreServerAPIClient(privateKeyP8, keyId, issuerId, bundleId, Environment.SANDBOX) : null;
    }

    static Set<InputStream> loadRoots() {
        InputStream root = AppleStoreGatewayImpl.class.getResourceAsStream("/apple/AppleRootCA-G3.cer");
        if (root == null) {
            throw new IllegalStateException("Apple root certificate resource is missing");
        }
        return Set.of(root);
    }

    @Override
    public boolean configured() {
        return true;
    }

    @Override
    public AppleTransaction verifyTransaction(String signedTransaction) {
        JWSTransactionDecodedPayload payload = decode(verifier -> verifier.verifyAndDecodeTransaction(signedTransaction));
        return transaction(payload, null);
    }

    @Override
    public AppleNotification verifyNotification(String signedPayload) {
        ResponseBodyV2DecodedPayload payload = decode(verifier -> verifier.verifyAndDecodeNotification(signedPayload));
        String type = payload.getNotificationType() == null ? payload.getRawNotificationType() : payload.getNotificationType().getValue();
        String subtype = payload.getSubtype() == null ? payload.getRawSubtype() : payload.getSubtype().getValue();
        Instant signed = payload.getSignedDate() == null ? null : Instant.ofEpochMilli(payload.getSignedDate());
        if (payload.getData() == null || payload.getData().getSignedTransactionInfo() == null) {
            return new AppleNotification(payload.getNotificationUUID(), type, subtype, signed, null);
        }
        // 알림 안의 거래·갱신 정보는 같은 환경의 검증기로 한 번 더 푼다.
        String env = payload.getData().getRawEnvironment();
        SignedDataVerifier verifier = "Production".equalsIgnoreCase(env) && production != null ? production : sandbox;
        try {
            JWSTransactionDecodedPayload tx = verifier.verifyAndDecodeTransaction(payload.getData().getSignedTransactionInfo());
            JWSRenewalInfoDecodedPayload renewal = payload.getData().getSignedRenewalInfo() == null ? null
                    : verifier.verifyAndDecodeRenewalInfo(payload.getData().getSignedRenewalInfo());
            return new AppleNotification(payload.getNotificationUUID(), type, subtype, signed, transaction(tx, renewal));
        } catch (VerificationException invalid) {
            throw failure(invalid);
        }
    }

    @Override
    public Optional<AppleTransaction> latest(String originalTransactionId, String environment) {
        boolean prod = "Production".equalsIgnoreCase(environment);
        AppStoreServerAPIClient client = prod ? productionClient : sandboxClient;
        if (client == null) {
            return Optional.empty();
        }
        try {
            StatusResponse status = client.getAllSubscriptionStatuses(originalTransactionId, null);
            SignedDataVerifier verifier = prod && production != null ? production : sandbox;
            if (status.getData() == null) {
                return Optional.empty();
            }
            for (SubscriptionGroupIdentifierItem group : status.getData()) {
                if (group.getLastTransactions() == null) {
                    continue;
                }
                for (LastTransactionsItem item : group.getLastTransactions()) {
                    if (originalTransactionId.equals(item.getOriginalTransactionId()) && item.getSignedTransactionInfo() != null) {
                        JWSTransactionDecodedPayload tx = verifier.verifyAndDecodeTransaction(item.getSignedTransactionInfo());
                        JWSRenewalInfoDecodedPayload renewal = item.getSignedRenewalInfo() == null ? null
                                : verifier.verifyAndDecodeRenewalInfo(item.getSignedRenewalInfo());
                        return Optional.of(transaction(tx, renewal));
                    }
                }
            }
            return Optional.empty();
        } catch (APIException | java.io.IOException | VerificationException unavailable) {
            // 조회는 보조다 — 실패해도 거래 JWS 로 판단한다. 사유 코드만 남긴다.
            LOG.warn("app store server api lookup failed type={}", unavailable.getClass().getSimpleName());
            return Optional.empty();
        }
    }

    private interface Decoder<T> {
        T apply(SignedDataVerifier verifier) throws VerificationException;
    }

    private <T> T decode(Decoder<T> decoder) {
        VerificationException last = null;
        if (production != null) {
            try {
                return decoder.apply(production);
            } catch (VerificationException failure) {
                if (failure.getStatus() != VerificationStatus.INVALID_ENVIRONMENT) {
                    throw failure(failure);
                }
                last = failure;
            }
        }
        try {
            return decoder.apply(sandbox);
        } catch (VerificationException failure) {
            throw failure(last != null && failure.getStatus() == VerificationStatus.INVALID_ENVIRONMENT ? last : failure);
        }
    }

    private static StoreException failure(VerificationException failure) {
        // 네트워크 때문에 확인하지 못한 경우만 다시 시도할 수 있는 오류로 본다.
        if (failure.getStatus() == VerificationStatus.RETRYABLE_VERIFICATION_FAILURE) {
            return new StoreException(StoreException.Kind.UPSTREAM, "store_upstream_error");
        }
        LOG.warn("apple signed data rejected status={}", failure.getStatus());
        return new StoreException(StoreException.Kind.INVALID, "invalid_store_receipt");
    }

    private static AppleTransaction transaction(JWSTransactionDecodedPayload tx, JWSRenewalInfoDecodedPayload renewal) {
        Boolean autoRenew = renewal == null || renewal.getAutoRenewStatus() == null ? null
                : renewal.getAutoRenewStatus() == AutoRenewStatus.ON;
        return new AppleTransaction(
                tx.getOriginalTransactionId(),
                tx.getTransactionId(),
                tx.getProductId(),
                (UUID) tx.getAppAccountToken(),
                instant(tx.getPurchaseDate()),
                instant(tx.getExpiresDate()),
                instant(tx.getRevocationDate()),
                autoRenew,
                renewal == null ? null : instant(renewal.getGracePeriodExpiresDate()),
                renewal != null && Boolean.TRUE.equals(renewal.getIsInBillingRetryPeriod()),
                tx.getRawEnvironment());
    }

    private static Instant instant(Long millis) {
        return millis == null ? null : Instant.ofEpochMilli(millis);
    }
}
