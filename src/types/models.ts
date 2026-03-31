export type UserRole = 'MASTER' | 'SCHOOL';

/**
 * 愿由ъ옄 (admins 而щ젆??
 */
export interface AdminUser {
  id: string; // Auth UID
  email: string;
  role: UserRole;
  assignedSchoolId?: string; // SCHOOL 沅뚰븳??寃쎌슦 ?占쎌닔
  name: string;
  createdAt: number; // Timestamp
}

/**
 * ?占쎄탳 ?占쎌젙 (schools 而щ젆??
 */
export interface SchoolConfig {
  id: string; // ?占쎄탳 ID (URL ?占쎈씪誘명꽣占??占쎌슜)
  
  // --- 1. 湲곕낯/?占쎌썝 ?占쎌젙 ---
  name: string;
  logoUrl: string;
  maxCapacity: number;     // ?占쎌긽 ?占쎌닔 ?占쎌썝
  waitlistCapacity: number; // ?占쏙옙??占쎌닔 ?占쎌썝 (0?占쎈㈃ ?占쏙옙??占쎌쓬)
  
  // --- 2. ?占쎌씠吏 ?占쎌뼱 ---
  openDateTime: string;    // ISO string (?占쎌닔 ?占쎌옉 ?占쎄컙)
  eventDate?: string;      // ISO string (?占쎌궗 ?占쎌옄)
  heroMessage?: string;    // Hero text used across gate and main screens
  programInfo?: string;    // Brief description of the event/program
  programImageUrl?: string; // 異뷂옙?: ?占쎈줈洹몃옩 ?占쏙옙?吏 URL (?占쎌씠???占쎌뾽??
  parkingMessage?: string; // Legacy hero copy; retained for backwards compatibility
  usePopup: boolean;       // ?占쎌뾽 ?占쎌슜 ?占쏙옙?
  popupContent?: string;   // ?占쎌뾽 ?占쎌슜 (HTML or Text)
  previewToken?: string;   // 誘몃━蹂닿린???占쏀겙 (?占쏀뵂 ???占쎄렐??

  // --- 2.5 ?占쎄린???占쎌젙 (queueSettings) ---
  queueSettings?: {
    batchSize: number;        // ??踰덉뿉 ?占쎌옣?占쏀궗 ?占쎌썝 (湲곕낯占? 100)
    batchInterval: number;    // ?? ?? (???)
    maxActiveSessions: number; // ??? ?? ??? ?? ??
    enabled: boolean;         // queue enabled
  };
  
  // --- 2.6 A/B ?占쎌뒪???占쎌젙 (abTestSettings) ---
  abTestSettings?: {
    enabled: boolean;         // A/B ?占쎌뒪???占쎌꽦???占쏙옙?
    splitRatio: number;       // Group A ?占쎈떦 鍮꾩쑉 (0-100, 湲곕낯占? 50)
    startDate?: string;       // ?占쎌뒪???占쎌옉 ?占쎄컙
    endDate?: string;         // ?占쎌뒪??醫낅즺 ?占쎄컙
  };

  // --- 3. ???占쎌쟻 ?占쎌뼱 (formFields) ---
  formFields: {
    collectEmail: boolean;
    collectAddress: boolean;
    collectSchoolName: boolean;
    collectGrade: boolean;
    gradeOptions?: string[];   // 異뷂옙?: ?占쎈뀈 ?占쏀깮 ?占쎌뀡 紐⑸줉
    collectStudentId: boolean; // ?占쎈쾲
  };
  
  // --- 4. ?占쎈┝???占쏀뵆占?(alimtalkSettings) ---
  alimtalkSettings: {
    // NHN Cloud API ?占쎌쬆 ?占쎈낫
    nhnAppKey?: string;      // NHN Cloud App Key
    nhnSecretKey?: string;   // NHN Cloud Secret Key
    nhnSenderKey?: string;   // NHN Cloud Sender Key (諛쒖떊踰덊샇)

    // ?占쎈┝???占쏀뵆占?肄붾뱶
    successTemplate: string;  // ?占쎌젙 ?占쎈┝???占쏀뵆占?肄붾뱶
    waitlistTemplate: string; // ?占쏙옙??占쎈┝???占쏀뵆占?肄붾뱶
    promoteTemplate?: string; // ?占쎈낫???占쏀뵆占?肄붾뱶 (?占쏀깮)
    confirmTemplateCode?: string; // ?占쎌젙 ?占쏀뵆占?肄붾뱶 (?占쎄퇋)
    waitlistTemplateCode?: string; // ?占쏙옙??占쏀뵆占?肄붾뱶 (?占쎄퇋)
  };
  
  // --- 5. 湲곤옙? ?占쎌젙 ---
  buttonSettings: {
    showLookupButton: boolean; // 議고쉶 踰꾪듉 ?占쎌텧 ?占쏙옙?
    showCancelButton: boolean; // 痍⑥냼 踰꾪듉 ?占쎌텧 ?占쏙옙?
  };
  
  serviceAccess?: {
    enabled: boolean;
    buttonLabel?: string;
    description?: string;
  };
  
  terms: {
    privacy: {
      title: string;
      content: string;
      required?: boolean;
    };
    thirdParty: {
      title: string;
      content: string;
      required?: boolean;
    };
    sms: {
      title: string;
      content: string;
      required?: boolean;
    };
  };
  
  isActive: boolean; // ?占쎄탳 ?占쎌씠吏 ?占쎌꽦???占쏙옙?
  createdAt: number;
  updatedAt: number;
}

export type RegistrationStatus = 'confirmed' | 'waitlisted' | 'canceled';

/**
 * ?占쎌껌 ?占쎌뿭 (schools/{schoolId}/registrations ?占쎈툕 而щ젆??
 */
export interface Registration {
  id: string;
  schoolId: string;
  studentName: string;
  phone: string;
  phoneLast4?: string;
  email?: string;
  address?: string;
  schoolName?: string;
  grade?: string;
  studentId?: string;
  status: RegistrationStatus;
  agreedSms?: boolean;
  rank?: number;
  submittedAt: number;
  updatedAt: number;
  ipAddress?: string;
}


