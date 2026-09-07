# SOMA-489 홈서버 이전·AWS 배포 보관 기록

현재 dev·운영 배포와 복구의 정본은 [DEPLOY-HOME.md](../../deploy/DEPLOY-HOME.md)다.
이 폴더는 이전에 사용한 AWS 구성과 홈서버 전환 판단을 보존한다. 여기의 인스턴스·IP·DNS 값과
AWS 배포 명령은 과거 기록이며 현재 운영 절차로 실행하지 않는다.

| 기록 | 보존한 범위 |
|---|---|
| [DEPLOY-DEV.md](./DEPLOY-DEV.md) | 단일 EC2의 웹·API·PostgreSQL·Caddy 개발 배포 |
| [DEPLOY-VPC.md](./DEPLOY-VPC.md) | EC2·ALB·RDS 운영 구성과 S3·SSM 배포, 자동 배포 도입 배경 |
| [DEV-HOME-CUTOVER.md](./DEV-HOME-CUTOVER.md) | 2026-09-03 dev DB 이전 절차와 실측 |
| [DEPLOY-HOME-CUTOVER.md](./DEPLOY-HOME-CUTOVER.md) | 운영 이전 준비·정지·DB 대조·도메인 전환·당시 AWS 역복원 절차 |

2026-09-07 사용자가 기존 AWS 자원 정리를 승인했다. 정리 범위는 기존 EC2·RDS·ALB·NAT·
CloudFront와 전용 배포 버킷·권한이며, 삭제 전 확보한 백업과 스냅샷은 보존한다. 서비스가 사용하는
영상 버킷·DB 백업 버킷·홈서버 IAM 사용자는 유지한다. 결정의 변경은 [ADR-026](../../ADR.md)에 기록했다.
자원별 삭제 완료 여부와 검증 결과는 실행 기록과 실제 AWS 상태로 확인한다.
