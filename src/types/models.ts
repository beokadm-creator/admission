export type UserRole = 'MASTER' | 'SCHOOL';

/**
 * 관리자 (admins 컬렉션)
 */
export interface AdminUser {
  id: string; // Auth UID
  email: string;
  role: UserRole;
  assignedSchoolId?: string; // SCHOOL 권한일 경우 필수
  name: string;
  createdAt: number; // Timestamp
}

/**
 * 학교 설정 (schools 컬렉션)
 */
export interface SchoolConfig {
  id: string; // 학교 ID (URL 파라미터로 사용)
  
  // --- 1. 기본/정원 설정 ---
  name: string;
  logoUrl: string;
  maxCapacity: number;     // 정상 접수 정원
  waitlistCapacity: number; // 대기 접수 정원 (0이면 대기 없음)
  
  // --- 2. 페이지 제어 ---
  openDateTime: string;    // ISO string (접수 시작 시간)
  parkingMessage?: string; // 오픈 전 대기 문구
  usePopup: boolean;       // 팝업 사용 여부
  popupContent?: string;   // 팝업 내용 (HTML or Text)
  previewToken?: string;   // 미리보기용 토큰 (오픈 전 접근용)

  // --- 2.5 대기열 설정 (queueSettings) ---
  queueSettings?: {
    batchSize: number;        // 한 번에 입장시킬 인원 (기본값: 100)
    batchInterval: number;    // 배치 간격 (밀리초, 기본값: 60000 = 1분)
    enabled: boolean;         // 대기열 시스템 사용 여부
  };
  
  // --- 2.6 A/B 테스트 설정 (abTestSettings) ---
  abTestSettings?: {
    enabled: boolean;         // A/B 테스트 활성화 여부
    splitRatio: number;       // Group A 할당 비율 (0-100, 기본값: 50)
    startDate?: string;       // 테스트 시작 시간
    endDate?: string;         // 테스트 종료 시간
  };

  // --- 3. 폼 동적 제어 (formFields) ---
  // --- 3. 폼 동적 제어 (formFields) ---
  // studentName, phone은 코드 레벨에서 필수 수집
  formFields: {
    collectEmail: boolean;
    collectAddress: boolean;
    collectSchoolName: boolean;
    collectGrade: boolean;
    collectStudentId: boolean; // 학번
    // 필요 시 추가
  };
  
  // --- 4. 알림톡 템플릿 (alimtalkSettings) ---
  alimtalkSettings: {
    // NHN Cloud API 인증 정보
    nhnAppKey?: string;      // NHN Cloud App Key
    nhnSecretKey?: string;   // NHN Cloud Secret Key
    nhnSenderKey?: string;   // NHN Cloud Sender Key (발신번호)
    
    // 알림톡 템플릿 코드
    successTemplate: string;  // 확정 알림톡 템플릿 코드
    waitlistTemplate: string; // 대기 알림톡 템플릿 코드
    promoteTemplate?: string; // 홍보용 템플릿 코드 (선택)
  };
  
  // --- 5. 기타 설정 ---
  buttonSettings: {
    showLookupButton: boolean; // 조회 버튼 노출 여부
    showCancelButton: boolean; // 취소 버튼 노출 여부
  };
  
  terms: {
    privacy: {
      title: string;
      content: string;
    };
    thirdParty: {
      title: string;
      content: string;
    };
    sms: {
      title: string;
      content: string;
    };
  };
  
  isActive: boolean; // 학교 페이지 활성화 여부
  createdAt: number;
  updatedAt: number;
}

export type RegistrationStatus = 'confirmed' | 'waitlisted' | 'canceled';

/**
 * 신청 내역 (schools/{schoolId}/registrations 서브 컬렉션)
 */
export interface Registration {
  id: string; // 자동 생성 ID
  schoolId: string;
  
  // 필수 수집 항목
  studentName: string;
  phone: string; // 010-0000-0000 포맷
  phoneLast4?: string; // 전화번호 뒤 4자리 (조회용)
  
  // 선택 수집 항목 (SchoolConfig.formFields에 따라 활성)
  email?: string;
  address?: string;
  schoolName?: string;
  grade?: string;
  studentId?: string;
  
  // 상태 관리
  status: RegistrationStatus;
  
  // 약관 동의
  agreedSms?: boolean;
  
  // 메타 데이터
  rank?: number; // 대기열 순번 (대기자일 경우)
  submittedAt: number; // 신청 시간
  updatedAt: number;
  ipAddress?: string; // 중복 방지 등을 위한 IP 기록
}
