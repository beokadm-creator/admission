# Error Handling — Architectural Decisions

## D-001: requestId를 localStorage에 유지하여 재시도 시 재사용
- **상태**: 제안
- **이유**: confirmRequestIdRef.current가 에러 시 null로 리셋되어 재시도 시 서버가 새 요청으로 처리
- **대안**: sessionStorage 유지 (탭별로 분리) vs localStorage 유지 (탭 간 공유)

## D-002: Register mount 시 registration 존재 여부 확인
- **상태**: 제안
- **이유**: validateSession은 reservation 유효성만 확인. registration이 이미 생성된 경우 complete 화면으로 이동해야 함
- **접근**: registrations/{sessionId} 문서 조회 후 존재하면 complete로 리다이렉트
