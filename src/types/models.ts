export type UserRole = 'MASTER' | 'SCHOOL';

export interface AdmissionRoundConfig {
  id: string;
  label: string;
  openDateTime: string;
  maxCapacity: number;
  waitlistCapacity: number;
  enabled: boolean;
}

export interface AdminUser {
  id: string;
  email: string;
  role: UserRole;
  assignedSchoolId?: string;
  name: string;
  createdAt: number;
}

export interface SchoolConfig {
  id: string;
  name: string;
  logoUrl: string;
  maxCapacity: number;
  waitlistCapacity: number;
  admissionRounds?: AdmissionRoundConfig[];
  openDateTime: string;
  eventDate?: string;
  heroMessage?: string;
  programInfo?: string;
  programImageUrl?: string;
  parkingMessage?: string;
  usePopup: boolean;
  popupContent?: string;
  previewToken?: string;
  queueSettings?: {
    maxActiveSessions: number;
    enabled: boolean;
  };
  sessionTimeoutSettings?: {
    activeSessionTimeoutMs?: number;
    gracePeriodMs?: number;
  };
  emergencyNotice?: {
    enabled: boolean;
    message: string;
  };
  forceActiveRound?: 'round1' | 'round2' | null;
  abTestSettings?: {
    enabled: boolean;
    splitRatio: number;
    startDate?: string;
    endDate?: string;
  };
  formFields: {
    collectEmail: boolean;
    collectAddress: boolean;
    collectSchoolName: boolean;
    collectGrade: boolean;
    gradeOptions?: string[];
    collectStudentId: boolean;
  };
  alimtalkSettings: {
    nhnAppKey?: string;
    nhnSecretKey?: string;
    nhnSenderKey?: string;
    successTemplate: string;
    waitlistTemplate: string;
    promoteTemplate?: string;
    confirmTemplateCode?: string;
    waitlistTemplateCode?: string;
  };
  buttonSettings: {
    showLookupButton: boolean;
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
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export type RegistrationStatus = 'confirmed' | 'waitlisted' | 'canceled';

export interface Registration {
  id: string;
  schoolId: string;
  admissionRoundId?: string;
  admissionRoundLabel?: string;
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
