# Draft: 라이브 전 취약점 분석

## Requirements (confirmed)
- 2026-04-03 기준 프로덕션 배포 완료 상태
- cleanupExpiredReservations write-then-read 버그 수정 및 재배포 완료
- 현재 상태: lastAssignedNumber: 9, currentNumber: 9, pendingAdmissionCount: 0, RTDB nextNumber: 9

## Research Findings
- firestore.rules: 존재하며 엄격하게 구성됨
- database.rules.json: 전체 잠금 (.read: false, .write: false) - admin SDK만 접근
- RTDB 큐 번호 발급: per-user lock + counter transaction으로 안전
- Firestore 트랜잭션: cleanupStaleQueueEntriesForSchool에서 이중 stateRef write 발견 (비크리티컬)

## Critical UX Bug Found
- Register.tsx line 328: confirmReservation에서 resource-exhausted/FULL_CAPACITY 에러 시 영어 원문 그대로 노출
- SmartQueueGate.tsx: resource-exhausted 계열 에러가 "접속자가 많아"로 잘못 변환될 여지 존재
- LSP 에러: button type, form label, static element interactivity

## Technical Decisions
- FULL_CAPACITY → 한국어 메시지로 변환 필요
- LSP 접근성 에러 → type="button"/"submit" 추가, label htmlFor/id 연결
- 코드 중복은 이번 스코프에서 제외 (라이브 전 긴급 항목 위주)

## Scope Boundaries
- INCLUDE: UX 메시지 버그 수정, 접근성 LSP 에러 수정
- EXCLUDE: 새 기능, UI 디자인 변경, 코드 중복 리팩터링, 성능 최적화
