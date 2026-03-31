# Queue Operational Stability Validation

## 목적

이 문서는 현재 Firestore 단일 저장소 기반 대기열이 실제 운영에서 안정적으로 동작하는지 검증하기 위한 최종 점검 기준입니다.

핵심 목표는 아래 3가지입니다.

1. 대기열이 끊기지 않고 순차적으로 자연스럽게 이어지는가
2. 작성 가능한 인원만 안전하게 입장시키고, 초과 진입을 막는가
3. 새로고침, 페이지 이탈, 세션 만료 상황에서도 데이터와 UX가 일관적인가

## 현재 운영 정책

- 대기열 저장소: Firestore only
- 작성 세션 시간: `3분`
- `waiting` presence timeout: `30초`
- `eligible` presence timeout: `20초`
- 동시 작성 제한: `queueSettings.maxActiveSessions`
- 기본 개방 정책: `batchSize = 1`, `batchInterval = 10초`

## 승인 기준

운영 승인 전 반드시 아래 조건을 충족해야 합니다.

1. `load-test-firestore-queue.mjs --scenario all` 가 PASS
2. 아래 수동 QA 시나리오가 모두 PASS
3. 운영자 화면에서 `queueState/current` 값과 실제 문서 수가 일치
4. Functions 로그에 `joinQueue`, `startRegistrationSession`, `confirmReservation`, `cleanupExpiredReservations`, `autoAdvanceQueue` 오류가 치명적으로 반복되지 않음

## 자동 검증

실행:

```bash
cd functions
npm run build
cd ..
firebase emulators:start --only firestore,functions,auth
node scripts/load-test-firestore-queue.mjs --scenario all
```

자동 검증이 확인해야 하는 항목:

- queue number 중복 없음
- 동일 `requestId` 재호출 시 동일 응답 반환
- 동일 사용자 활성 reservation 1개 이하
- `confirmReservation` 와 `forceExpireSession` 경합 시 최종 상태 단일화
- `availableCapacity >= 0`
- `lastAssignedNumber >= currentNumber`
- `activeReservationCount` 와 실제 active reservation 수 일치
- `registrations == confirmedCount + waitlistedCount`

## 수동 브라우저 QA

### 1. 대기열 진입

목표:
- 첫 사용자가 바로 `eligible` 또는 현재 입장 가능 상태로 열리는지 확인
- 이후 사용자는 `waiting` 으로 순차 대기하는지 확인

기대 결과:
- 첫 사용자 `queueEntries/{userId}.status` 가 즉시 입장 가능 상태로 반영됨
- 다음 사용자는 `waiting`
- `queueState/current.lastAssignedNumber` 가 증가

### 2. 대기 중 새로고침

절차:
1. 사용자 A가 대기열에 진입
2. `waiting` 상태에서 페이지를 새로고침
3. 5초 내 화면이 다시 로드되는지 확인

기대 결과:
- 같은 번호 유지
- 같은 `queueEntries/{userId}` 문서 재사용
- 새 번호가 발급되지 않음
- `lastSeenAt` 가 갱신됨

### 3. 대기 중 완전 이탈

절차:
1. 사용자 A가 `waiting`
2. 탭을 닫거나 다른 페이지로 완전히 이동
3. 35초 이상 대기
4. 관리자 화면 또는 Firestore 문서 확인

기대 결과:
- `queueEntries/{userId}.status = expired`
- 다음 대기자가 있으면 자연스럽게 승격
- `pendingAdmissionCount` 가 음수로 내려가지 않음

### 4. eligible 상태 자동 진입

절차:
1. 사용자 A를 `eligible` 상태로 만들기
2. 대기 화면을 유지한 채 관찰

기대 결과:
- 게이트에서 강한 입장 안내 표시
- 2초 내 자동으로 작성 페이지 이동 시도
- 자동 이동 실패 시 수동 진입 버튼으로 복구 가능

### 5. eligible 상태 새로고침 복구

절차:
1. 사용자 A가 `eligible`
2. 작성 페이지로 넘어가기 직전 새로고침
3. 10초 내 동일 화면 복구 여부 확인

기대 결과:
- `eligible` 상태 유지 또는 이미 생성된 reservation 세션 복구
- 억울한 탈락 없음
- 가능한 경우 자동 진입이 다시 이어짐

### 6. eligible 상태 완전 이탈

절차:
1. 사용자 A가 `eligible`
2. 탭 닫기 또는 다른 페이지 이동
3. 25초 이상 대기

기대 결과:
- 사용자 A `queueEntries/{userId}.status = expired`
- `pendingAdmissionCount` 가 정리됨
- 다음 대기자가 `eligible` 로 승격
- 사용자 화면 기준으로 큐가 멈춘 것처럼 보이지 않음

### 7. 작성 페이지 새로고침

절차:
1. 사용자 A가 작성 페이지 진입
2. 3분 내 새로고침

기대 결과:
- 기존 `reservationId` 복구
- 새 세션이 생기지 않음
- 카운트다운은 남은 시간 기준으로 복구

### 8. 작성 페이지 이탈 후 만료

절차:
1. 사용자 A가 작성 페이지 진입
2. 제출하지 않고 페이지를 닫음
3. 3분 이상 대기

기대 결과:
- `reservations/{reservationId}.status = expired`
- `activeReservationCount` 감소
- 다음 대기자가 자연스럽게 열림
- 사용자 A는 자동 재진입되지 않음

### 9. 만료 후 재입장

절차:
1. 작성 세션을 만료시킴
2. 게이트로 돌아온 뒤 `다시 대기열 입장하기` 클릭

기대 결과:
- 과거 `requestId` 재사용 없이 새 요청 생성
- 이전 번호 재사용이 아니라 새 번호 발급
- 자동으로 작성 페이지에 다시 끌려 들어가지 않음

### 10. 작성 완료 이후

절차:
1. 사용자 A가 3분 내 제출 완료
2. 완료 페이지 확인

기대 결과:
- `confirmed` 또는 `waitlisted` 상태별 안내가 명확함
- 조회 페이지 또는 메인 이동 버튼 제공
- 다시 작성 페이지로 복귀하지 않음

## 운영자 화면 확인 항목

관리자 화면에서 아래 값이 눈에 띄게 어긋나지 않아야 합니다.

- 현재 입장 번호
- 마지막 발급 번호
- 현재 작성 중 인원
- 열린 입장 슬롯
- 동시 작성 한도
- 남은 모집 인원

특히 아래는 즉시 점검 대상입니다.

- `availableCapacity < 0`
- `activeReservationCount > maxActiveSessions`
- `pendingAdmissionCount > maxActiveSessions`
- `lastAssignedNumber < currentNumber`

## 실제 행사 전 스테이징 리허설

권장 규모:

- 30명: 기본 검증
- 60명: 기본 운영값 검증
- 100명+: 점진적 체감 대기 시간 확인

리허설 목표:

- 대기열이 한 번 열리고 나서 계속 이어지는지
- no-show, 만료, 새로고침이 있어도 다음 순번이 자연스럽게 열리는지
- 관리자 화면 숫자가 실제 체감과 일치하는지

## 장애 판단 기준

즉시 수정이 필요한 상태:

- 번호는 전진하는데 누구도 `eligible` 가 되지 않음
- 새로고침만 했는데 대기열에서 자주 탈락함
- 만료 후 자동으로 다시 작성 페이지 진입
- 동일 사용자에게 활성 reservation 2개 이상 생성
- `availableCapacity` 또는 `pendingAdmissionCount` 가 음수

운영 튜닝으로 해결 가능한 상태:

- `waiting 30초`, `eligible 20초` 가 실제 모바일 환경에 너무 짧거나 김
- `maxActiveSessions` 값이 현장 처리 속도에 비해 과하거나 부족함
- `batchInterval` 이 체감상 너무 느리거나 빠름

## 최종 판단

아래가 충족되면 “안정 운영 가능”으로 판단합니다.

- 자동 검증 PASS
- 브라우저 QA PASS
- queue가 만료와 이탈 상황에서도 계속 순차적으로 이어짐
- 운영자 화면 수치와 실제 문서 수가 일치
- 새로고침은 복구되고, 진짜 이탈은 정리됨
