# Acttub

배우가 연기 연습 영상을 올리면 관찰을 뽑아내고, 코치와의 대화를 거쳐 근거 기반 리포트를 만드는 플랫폼입니다.
`apps/web`·`apps/api`·`apps/api-java`가 같은 도메인을 공유하므로 용어집은 하나입니다.

## Language

### 연습 분석

**Observation**:
연습 영상에서 뽑아낸 연기 관찰. 6축 관찰과 이상 구간으로 구성되며, 세션 시작 시 한 번만 만들어집니다(ADR-AI-003).
_Avoid_: 요약, summary, 분석 결과

### 비동기 작업

**External Operation**:
외부 호출(LLM·S3·영상 분석)을 수반해 한 트랜잭션 안에서 끝낼 수 없는 작업. `external_operations` 원장의 한 항목이며 멱등키로 중복 생성을 막습니다.
_Avoid_: 작업, 잡, 태스크, job

**Lease**:
워커가 External Operation을 점유했다는 표식. 만료되면 다른 워커가 회수할 수 있고, 리스를 잃은 워커의 완료 처리는 거부됩니다.
_Avoid_: 락, 점유권, lock

**Report Source**:
소유권 검증이 끝난, 리포트 생성에 필요한 코치 세션 문맥. 리포트를 만드는 쪽이 요구하고 코치 쪽이 제공합니다.
_Avoid_: 리포트 컨텍스트, 세션 데이터

### 입시

**Admissions**:
대학 입시 공고 카탈로그. 배우 지망생이 참고하는 공고 목록이며, 인증의 admission control과 무관합니다.
_Avoid_: admission(단수형), 입장, 입장 제어

### 영속

**Schema Entity**:
런타임 영속화가 아니라 `ddl-auto: validate`가 실제 스키마를 대조하는 데 쓰이는 JPA 엔티티. 데이터 접근은 전부 손으로 쓴 SQL이 담당하므로 이 엔티티들은 호출되지 않습니다.
_Avoid_: 도메인 모델, 엔티티(수식 없이)
