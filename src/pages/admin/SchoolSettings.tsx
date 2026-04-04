import React, { useEffect, useMemo, useState } from 'react';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useNavigate, useParams } from 'react-router-dom';
import { useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { collection, deleteField, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, setDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CheckSquare,
  Clock,
  LogOut,
  RefreshCw,
  Save,
  Search,
  Settings,
  Users
} from 'lucide-react';
import { format } from 'date-fns';
import { db, functions } from '../../firebase/config';
import RegistrationList from '../../components/RegistrationList';
import { useAuth } from '../../contexts/AuthContext';
import { SchoolConfig } from '../../types/models';
import { getAdmissionRoundTotal, getCurrentAdmissionRound, normalizeAdmissionRounds } from '../../lib/admissionRounds';

interface SlotStats {
  total: number;
  reserved: number;
  confirmed: number;
  available: number;
  lastUpdated: number;
  currentNumber?: number;
  lastAssignedNumber?: number;
  pendingAdmissionCount?: number;
  waitlistedCount?: number;
  queueEnabled?: boolean;
  lastAdvancedAt?: number;
  maxActiveSessions?: number;
}

interface Reservation {
  id?: string;
  userId: string;
  status: 'reserved' | 'processing' | 'confirmed' | 'expired';
  createdAt: number;
  expiresAt: number;
}

interface AlimtalkTemplateOption {
  templateCode: string;
  templateName: string;
  templateContent?: string;
  inspectionStatus?: string;
  statusName?: string;
  buttons?: Array<{ name?: string; type?: string }>;
}

type SettingsFormValues = SchoolConfig & {
  formFields: SchoolConfig['formFields'] & {
    gradeOptionsText?: string;
  };
};

const inputClassName =
  'block w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';

const textareaClassName =
  'block w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';

const selectClassName =
  'block w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';

const emptySlotStats = (total = 0): SlotStats => ({
  total,
  reserved: 0,
  confirmed: 0,
  available: total,
  lastUpdated: Date.now()
});

function formatTime(timestamp: number) {
  return format(new Date(timestamp), 'HH:mm:ss');
}

function toLocalDateTimeValue(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 16);
}

function toIsoDateTime(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString();
}

function normalizeTemplateList(rawTemplates: any[]): AlimtalkTemplateOption[] {
  return rawTemplates
    .map((item) => ({
      templateCode: item.templateCode || item.code || '',
      templateName: item.templateName || item.name || item.templateNameKr || '이름 없는 템플릿',
      templateContent: item.templateContent || item.content || '',
      inspectionStatus: item.inspectionStatus || item.status || item.templateStatus || '',
      statusName: item.statusName || item.inspectionStatusName || '',
      buttons: item.buttons || item.buttonsInfo || []
    }))
    .filter((item) => item.templateCode)
    .sort((a, b) => a.templateName.localeCompare(b.templateName, 'ko-KR'));
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>
      {children}
      {hint && <p className="mt-1 text-xs leading-relaxed text-gray-500">{hint}</p>}
    </label>
  );
}

function OverviewCard({
  label,
  value,
  helper,
  tone
}: {
  label: string;
  value: number;
  helper: string;
  tone: 'blue' | 'amber' | 'green' | 'violet';
}) {
  const toneClasses = {
    blue: 'border-blue-200 bg-blue-50 text-blue-900',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    violet: 'border-violet-200 bg-violet-50 text-violet-900'
  };

  return (
    <div className={`rounded-2xl border p-4 ${toneClasses[tone]}`}>
      <p className="text-sm font-semibold">{label}</p>
      <p className="mt-2 text-3xl font-black">{value.toLocaleString()}</p>
      <p className="mt-1 text-xs opacity-80">{helper}</p>
    </div>
  );
}

function SummaryCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
      <p className="text-sm font-medium text-gray-500">{title}</p>
      <p className="mt-2 text-xl font-bold text-gray-900">{value}</p>
    </div>
  );
}

function TemplatePreview({ template }: { template?: AlimtalkTemplateOption }) {
  if (!template) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-500">
        선택된 템플릿이 없습니다.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-gray-900">{template.templateName}</p>
          <p className="mt-1 text-xs text-gray-500">코드: {template.templateCode}</p>
        </div>
        {(template.statusName || template.inspectionStatus) && (
          <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
            {template.statusName || template.inspectionStatus}
          </span>
        )}
      </div>
      {template.templateContent && (
        <p className="mt-3 whitespace-pre-line rounded-lg bg-gray-50 p-3 text-sm leading-relaxed text-gray-700">
          {template.templateContent}
        </p>
      )}
      {template.buttons && template.buttons.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {template.buttons.map((button, index) => (
            <span key={`${template.templateCode}-${index}`} className="rounded-full border border-gray-200 px-3 py-1 text-xs text-gray-600">
              {button.name || `버튼 ${index + 1}`}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SchoolSettings() {
  const { schoolId } = useParams<{ schoolId: string }>();
  const { adminProfile, signOut } = useAuth();
  const navigate = useNavigate();

  const [pageLoading, setPageLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'settings' | 'reservations' | 'registrations'>('overview');
  const [slotStats, setSlotStats] = useState<SlotStats | null>(null);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loadingReservations, setLoadingReservations] = useState(false);
  const [templateOptions, setTemplateOptions] = useState<AlimtalkTemplateOption[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [templateLoadError, setTemplateLoadError] = useState<string | null>(null);
  const [templateLoadSuccess, setTemplateLoadSuccess] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [emergencyLoading, setEmergencyLoading] = useState(false);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  // forceActiveRound 실제 DB 값 (watch()는 form 초기값만 반영하므로 별도 관리)
  const [activeForceRound, setActiveForceRound] = useState<'round1' | 'round2' | null>(null);

  const { register, handleSubmit, setValue, watch, reset } = useForm<SettingsFormValues>();

  const watchedRound1RegularCapacity = watch('admissionRounds.0.maxCapacity') || 0;
  const watchedRound1WaitlistCapacity = watch('admissionRounds.0.waitlistCapacity') || 0;
  const watchedRound1OpenDateTime = watch('admissionRounds.0.openDateTime') || '';
  const watchedRound2Enabled = watch('admissionRounds.1.enabled') === true;
  const watchedRound2OpenDateTime = watch('admissionRounds.1.openDateTime') || '';
  const watchedRound2RegularCapacity = watch('admissionRounds.1.maxCapacity') || 0;
  const watchedRound2WaitlistCapacity = watch('admissionRounds.1.waitlistCapacity') || 0;
  const watchedMaxActiveSessions = watch('queueSettings.maxActiveSessions') || 60;
  const watchedNhnAppKey = watch('alimtalkSettings.nhnAppKey') || '';
  const watchedNhnSecretKey = watch('alimtalkSettings.nhnSecretKey') || '';
  const watchedSuccessTemplate = watch('alimtalkSettings.successTemplate') || '';
  const watchedWaitlistTemplate = watch('alimtalkSettings.waitlistTemplate') || '';
  const watchedPromoteTemplate = watch('alimtalkSettings.promoteTemplate') || '';
  const totalManagedCapacity =
    watchedRound1RegularCapacity +
    watchedRound1WaitlistCapacity +
    (watchedRound2Enabled ? watchedRound2RegularCapacity + watchedRound2WaitlistCapacity : 0);

  const currentAdmissionRound = useMemo(
    () =>
      getCurrentAdmissionRound({
        openDateTime: watchedRound1OpenDateTime,
        maxCapacity: watchedRound1RegularCapacity,
        waitlistCapacity: watchedRound1WaitlistCapacity,
        admissionRounds: [
          {
            id: 'round1',
            label: '1차',
            openDateTime: watchedRound1OpenDateTime,
            maxCapacity: watchedRound1RegularCapacity,
            waitlistCapacity: watchedRound1WaitlistCapacity,
            enabled: true
          },
          {
            id: 'round2',
            label: '2차',
            openDateTime: watchedRound2OpenDateTime,
            maxCapacity: watchedRound2RegularCapacity,
            waitlistCapacity: watchedRound2WaitlistCapacity,
            enabled: watchedRound2Enabled
          }
        ]
      }),
    [
      watchedRound1OpenDateTime,
      watchedRound1RegularCapacity,
      watchedRound1WaitlistCapacity,
      watchedRound2Enabled,
      watchedRound2OpenDateTime,
      watchedRound2RegularCapacity,
      watchedRound2WaitlistCapacity
    ]
  );

  const currentRoundTotalCapacity = useMemo(
    () => getAdmissionRoundTotal(currentAdmissionRound),
    [currentAdmissionRound]
  );
  const selectedSuccessTemplate = useMemo(
    () => templateOptions.find((item) => item.templateCode === watchedSuccessTemplate),
    [templateOptions, watchedSuccessTemplate]
  );
  const selectedWaitlistTemplate = useMemo(
    () => templateOptions.find((item) => item.templateCode === watchedWaitlistTemplate),
    [templateOptions, watchedWaitlistTemplate]
  );
  const selectedPromoteTemplate = useMemo(
    () => templateOptions.find((item) => item.templateCode === watchedPromoteTemplate),
    [templateOptions, watchedPromoteTemplate]
  );

  useEffect(() => {
    if (!schoolId) return;

    if (adminProfile?.role === 'SCHOOL' && adminProfile.assignedSchoolId !== schoolId) {
      alert('접근 권한이 없습니다.');
      navigate('/admin');
      return;
    }

    const loadSchool = async () => {
      try {
        const docSnap = await getDoc(doc(db, 'schools', schoolId));
        if (!docSnap.exists()) {
          alert('학교 설정을 찾을 수 없습니다.');
          navigate('/admin/schools');
          return;
        }

        const data = docSnap.data() as SchoolConfig;
        setActiveForceRound((data.forceActiveRound as 'round1' | 'round2' | null) ?? null);
        const privateSettingsSnap = await getDoc(doc(db, 'schools', schoolId, 'privateSettings', 'alimtalk'));
        const privateAlimtalk = privateSettingsSnap.exists() ? privateSettingsSnap.data() : null;
        const heroMessage = data.heroMessage || data.parkingMessage || '';
        
        const rounds = normalizeAdmissionRounds(data);
        const formValues: any = {
            ...data,
            id: schoolId,
            name: data.name || '',
            logoUrl: data.logoUrl || '',
            eventDate: data.eventDate ? data.eventDate.slice(0, 10) : '',
            heroMessage,
            programInfo: data.programInfo || '',
            admissionRounds: [
                {
                    ...rounds[0],
                    id: 'round1',
                    label: '1차',
                    openDateTime: toLocalDateTimeValue(rounds[0]?.openDateTime || data.openDateTime),
                    maxCapacity: rounds[0]?.maxCapacity || data.maxCapacity || 0,
                    waitlistCapacity: rounds[0]?.waitlistCapacity || data.waitlistCapacity || 0,
                    enabled: true
                },
                {
                    ...rounds[1],
                    id: 'round2',
                    label: '2차',
                    openDateTime: toLocalDateTimeValue(rounds[1]?.openDateTime),
                    maxCapacity: rounds[1]?.maxCapacity || 0,
                    waitlistCapacity: rounds[1]?.waitlistCapacity || 0,
                    enabled: rounds[1]?.enabled === true
                }
            ],
            queueSettings: {
                enabled: data.queueSettings?.enabled !== false,
                maxActiveSessions: data.queueSettings?.maxActiveSessions || 60
            },
            alimtalkSettings: {
                nhnAppKey: privateAlimtalk?.nhnAppKey || '',
                nhnSecretKey: privateAlimtalk?.nhnSecretKey || '',
                nhnSenderKey: privateAlimtalk?.nhnSenderKey || '',
                successTemplate: data.alimtalkSettings?.successTemplate || data.alimtalkSettings?.confirmTemplateCode || '',
                waitlistTemplate: data.alimtalkSettings?.waitlistTemplate || data.alimtalkSettings?.waitlistTemplateCode || '',
                promoteTemplate: data.alimtalkSettings?.promoteTemplate || '',
                confirmTemplateCode: data.alimtalkSettings?.confirmTemplateCode || data.alimtalkSettings?.successTemplate || '',
                waitlistTemplateCode: data.alimtalkSettings?.waitlistTemplateCode || data.alimtalkSettings?.waitlistTemplate || ''
            },
            formFields: {
                ...data.formFields,
                gradeOptionsText: (data.formFields?.gradeOptions || []).join('\n')
            },
            // DB 저장값은 ms 단위 → 폼 표시용으로 역변환 (분/초)
            sessionTimeoutSettings: {
                activeSessionTimeoutMs: Math.round((data.sessionTimeoutSettings?.activeSessionTimeoutMs || 3 * 60 * 1000) / (60 * 1000)),
                gracePeriodMs: Math.round((data.sessionTimeoutSettings?.gracePeriodMs || 90 * 1000) / 1000)
            }
        };
        
        reset(formValues);

        // Load audit logs if MASTER
        if (adminProfile?.role === 'MASTER') {
          const logsRef = collection(db, 'schools', schoolId, 'adminAuditLogs');
          const logsSnap = await getDocs(query(logsRef, orderBy('timestamp', 'desc'), limit(10)));
          setAuditLogs(logsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        }
      } catch (error) {
        console.error('Error loading school settings:', error);
        alert('학교 설정을 불러오는 중 오류가 발생했습니다.');
      } finally {
        setPageLoading(false);
      }
    };

    void loadSchool();
  }, [adminProfile, navigate, schoolId, reset]);

  useEffect(() => {
    if (!schoolId || !currentAdmissionRound) return;

    const queueStateDocRef = doc(db, 'schools', schoolId, 'queueState', currentAdmissionRound.id);
    const unsubscribe = onSnapshot(
      queueStateDocRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();

          setSlotStats({
            total: Number(data.totalCapacity ?? currentRoundTotalCapacity),
            reserved: Number(data.activeReservationCount ?? 0),
            confirmed: Number(data.confirmedCount ?? 0) + Number(data.waitlistedCount ?? 0),
            available: Number(data.availableCapacity ?? currentRoundTotalCapacity),
            lastUpdated: Number(data.updatedAt ?? Date.now()),
            currentNumber: Number(data.currentNumber ?? 0),
            lastAssignedNumber: Number(data.lastAssignedNumber ?? 0),
            pendingAdmissionCount: Number(data.pendingAdmissionCount ?? 0),
            waitlistedCount: Number(data.waitlistedCount ?? 0),
            queueEnabled: data.queueEnabled !== false,
            lastAdvancedAt: Number(data.lastAdvancedAt ?? 0),
            maxActiveSessions: Number(data.maxActiveSessions ?? 60)
          });
          return;
        }

        setSlotStats(emptySlotStats(currentRoundTotalCapacity));
      },
      (error) => {
        console.error('Error fetching slot stats:', error);
        setSlotStats(emptySlotStats(currentRoundTotalCapacity));
      }
    );

    return unsubscribe;
  }, [currentAdmissionRound, currentRoundTotalCapacity, schoolId]);

  const loadReservations = useCallback(async () => {
    if (!schoolId) return;

    setLoadingReservations(true);
    try {
      const getReservations = httpsCallable(functions, 'getAdminReservations');
      const response: any = await getReservations({ schoolId });
      const reservationList = (response.data?.reservations || [])
        .map((item: any) => ({ ...item } as Reservation))
        .sort((a, b) => b.createdAt - a.createdAt);

      setReservations(reservationList);
    } catch (error) {
      console.error('Error loading reservations:', error);
      setReservations([]);
    } finally {
      setLoadingReservations(false);
    }
  }, [schoolId]);

  useEffect(() => {
    if (activeTab === 'reservations' && schoolId) {
      void loadReservations();
    }
  }, [activeTab, loadReservations, schoolId]);

  const progressRate = useMemo(() => {
    if (!slotStats?.total) return 0;
    return Math.min(100, Math.round(((slotStats.confirmed + slotStats.reserved) / slotStats.total) * 100));
  }, [slotStats]);

  const handleRecalculate = async () => {
    if (!schoolId) return;
    setEmergencyLoading(true);
    try {
      const runAction = httpsCallable(functions, 'runAdminQueueAction');
      await runAction({ schoolId, action: 'recalculateState' });
      alert('데이터 정산이 완료되었습니다. 최신 현황이 반영되었습니다.');
    } catch (error: any) {
      console.error('Recalculate error:', error);
      alert('정산 중 오류가 발생했습니다: ' + (error.message || '알 수 없는 오류'));
    } finally {
      setEmergencyLoading(false);
    }
  };

  const handleCleanupStale = async () => {
    if (!schoolId) return;
    setEmergencyLoading(true);
    try {
      const runAction = httpsCallable(functions, 'runAdminQueueAction');
      const response: any = await runAction({ schoolId, action: 'expireStaleReservations' });
      alert(`만료 세션 정리가 완료되었습니다. (정리된 세션: ${response.data?.expiredCount || 0}개)`);
    } catch (error: any) {
      console.error('Cleanup error:', error);
      alert('정리 중 오류가 발생했습니다: ' + (error.message || '알 수 없는 오류'));
    } finally {
      setEmergencyLoading(false);
    }
  };

  const handleQuickBoost = async (amount: number) => {
    if (!schoolId || !currentAdmissionRound) return;
    if (!window.confirm(`${currentAdmissionRound.label}의 정규 정원을 ${amount}명 늘리시겠습니까?`)) return;

    setEmergencyLoading(true);
    try {
      const roundIdx = currentAdmissionRound.id === 'round1' ? 0 : 1;
      const currentVal = Number(watch(`admissionRounds.${roundIdx}.maxCapacity` as any) || 0);
      const newVal = currentVal + amount;
      
      setValue(`admissionRounds.${roundIdx}.maxCapacity` as any, newVal);
      await handleSubmit(onSubmit)();
    } catch (error: any) {
      console.error('Boost error:', error);
      alert('증원 중 오류가 발생했습니다.');
    } finally {
      setEmergencyLoading(false);
    }
  };

  const handleForceRoundSwitch = async (roundId: 'round1' | 'round2' | null) => {
    if (!schoolId) return;
    const label = roundId === 'round1' ? '1차 강제 활성화' : roundId === 'round2' ? '2차 강제 활성화' : '자동 전환 모드';
    if (!window.confirm(`${label}로 설정을 변경하시겠습니까?`)) return;

    setEmergencyLoading(true);
    try {
      await setDoc(doc(db, 'schools', schoolId), {
        forceActiveRound: roundId,
        updatedAt: Date.now()
      }, { merge: true });
      setActiveForceRound(roundId);
      alert(`${label} 설정이 완료되었습니다.`);
    } catch (error: any) {
      console.error('Force switch error:', error);
      alert('설정 변경 중 오류가 발생했습니다.');
    } finally {
      setEmergencyLoading(false);
    }
  };

  const handleFullReset = async () => {
    if (!window.confirm('경고: 해당 학교의 모든 신청 내역, 예약 세션, 대기열이 즉시 초기화됩니다.\n정말로 모든 데이터를 리셋하시겠습니까?')) return;
    
    const confirmInput = prompt('초기화를 위해 "데이터초기화" 라고 정확히 입력해 주세요.');
    if (confirmInput !== '데이터초기화') {
      alert('입력된 문구가 정확하지 않습니다.');
      return;
    }

    setResetting(true);
    try {
      const resetFn = httpsCallable(functions, 'resetSchoolState');
      await resetFn({ schoolId });
      alert('모든 데이터가 성공적으로 초기화되었습니다.');
      window.location.reload();
    } catch (error: any) {
      console.error('Reset error:', error);
      alert('초기화 중 오류가 발생했습니다: ' + (error.message || '알 수 없는 오류'));
    } finally {
      setResetting(false);
    }
  };

  const handleLoadTemplates = async () => {
    if (!watchedNhnAppKey?.trim() || !watchedNhnSecretKey?.trim()) {
      setTemplateLoadError('NHN App Key와 Secret Key를 먼저 입력해 주세요.');
      setTemplateLoadSuccess(null);
      return;
    }

    setLoadingTemplates(true);
    setTemplateLoadError(null);
    setTemplateLoadSuccess(null);

    try {
      const fetchTemplates = httpsCallable(functions, 'getAlimtalkTemplates');
      const response: any = await fetchTemplates({
        appKey: watchedNhnAppKey.trim(),
        secretKey: watchedNhnSecretKey.trim()
      });

      const templates = normalizeTemplateList(response.data?.templates || []);
      setTemplateOptions(templates);
      if (templates.length === 0) {
        setTemplateLoadSuccess('조회는 완료됐지만 불러온 템플릿이 없습니다.');
      } else {
        setTemplateLoadSuccess(`${templates.length.toLocaleString()}개의 템플릿을 불러왔습니다.`);
      }
    } catch (error: any) {
      console.error('Error loading templates:', error);
      setTemplateLoadError(error?.message || '템플릿을 불러오는 중 오류가 발생했습니다.');
    } finally {
      setLoadingTemplates(false);
    }
  };

  const applyTemplate = (target: 'success' | 'waitlist' | 'promote', code: string) => {
    if (target === 'success') {
      setValue('alimtalkSettings.successTemplate', code);
      setValue('alimtalkSettings.confirmTemplateCode', code);
      return;
    }
    if (target === 'waitlist') {
      setValue('alimtalkSettings.waitlistTemplate', code);
      setValue('alimtalkSettings.waitlistTemplateCode', code);
      return;
    }
    setValue('alimtalkSettings.promoteTemplate', code);
  };

  const onSubmit = async (data: SettingsFormValues) => {
    if (!schoolId) return;

    try {
      const heroCopy = data.heroMessage?.trim() || '';
      const programCopy = data.programInfo?.trim() || '';
      const maxActiveSessions = Math.max(1, data.queueSettings?.maxActiveSessions || 60);
      const admissionRounds = normalizeAdmissionRounds({
        ...data,
        admissionRounds: (data.admissionRounds || []).map((round) => ({
          ...round,
          openDateTime: toIsoDateTime(round.openDateTime)
        }))
      });
      const firstRound = admissionRounds[0];
      const firstRoundTotal = (firstRound?.maxCapacity || 0) + (firstRound?.waitlistCapacity || 0);
      const successTemplate =
        data.alimtalkSettings?.successTemplate?.trim() || data.alimtalkSettings?.confirmTemplateCode?.trim() || '';
      const waitlistTemplate =
        data.alimtalkSettings?.waitlistTemplate?.trim() || data.alimtalkSettings?.waitlistTemplateCode?.trim() || '';
      const promoteTemplate = data.alimtalkSettings?.promoteTemplate?.trim() || '';
      
      const sanitizedDoc: any = {
        ...data,
        id: schoolId,
        maxCapacity: firstRound?.maxCapacity || 0,
        waitlistCapacity: firstRound?.waitlistCapacity || 0,
        openDateTime: firstRound?.openDateTime || '',
        admissionRounds: admissionRounds.map(r => ({ ...r, openDateTime: toIsoDateTime(r.openDateTime) })),
        eventDate: data.eventDate || '',
        heroMessage: heroCopy,
        parkingMessage: heroCopy,
        programInfo: programCopy,
        programImageUrl: data.programImageUrl || '',
        popupContent: data.popupContent || '',
        previewToken: data.previewToken || '',
        queueSettings: {
          enabled: data.queueSettings?.enabled !== false,
          maxActiveSessions
        },
        formFields: {
          collectEmail: !!data.formFields?.collectEmail,
          collectAddress: !!data.formFields?.collectAddress,
          collectSchoolName: !!data.formFields?.collectSchoolName,
          collectGrade: !!data.formFields?.collectGrade,
          collectStudentId: !!data.formFields?.collectStudentId,
          gradeOptions: (data.formFields as any)?.gradeOptionsText
            ? ((data.formFields as any).gradeOptionsText as string)
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean)
            : []
        },
        alimtalkSettings: {
          successTemplate,
          waitlistTemplate,
          promoteTemplate,
          confirmTemplateCode: successTemplate,
          waitlistTemplateCode: waitlistTemplate
        },
        sessionTimeoutSettings: {
          activeSessionTimeoutMs: (data.sessionTimeoutSettings?.activeSessionTimeoutMs || 3) * 60 * 1000,
          gracePeriodMs: (data.sessionTimeoutSettings?.gracePeriodMs || 90) * 1000
        },
        emergencyNotice: {
          enabled: !!data.emergencyNotice?.enabled,
          message: data.emergencyNotice?.message || ''
        },
        updatedAt: Date.now()
      };

      await setDoc(doc(db, 'schools', schoolId), sanitizedDoc, { merge: true });
      await setDoc(
        doc(db, 'schools', schoolId, 'privateSettings', 'alimtalk'),
        {
          nhnAppKey: data.alimtalkSettings?.nhnAppKey?.trim() || '',
          nhnSecretKey: data.alimtalkSettings?.nhnSecretKey?.trim() || '',
          nhnSenderKey: data.alimtalkSettings?.nhnSenderKey?.trim() || '',
          updatedAt: Date.now()
        },
        { merge: true }
      );
      
      // Update Queue States
      await setDoc(
        doc(db, 'schools', schoolId, 'queueState', 'round1'),
        {
          roundId: 'round1',
          totalCapacity: firstRoundTotal,
          queueEnabled: sanitizedDoc.queueSettings.enabled,
          maxActiveSessions: sanitizedDoc.queueSettings.maxActiveSessions,
          updatedAt: Date.now()
        },
        { merge: true }
      );
      if (admissionRounds[1]) {
        await setDoc(
            doc(db, 'schools', schoolId, 'queueState', 'round2'),
            {
              roundId: 'round2',
              totalCapacity: (admissionRounds[1].maxCapacity || 0) + (admissionRounds[1].waitlistCapacity || 0),
              queueEnabled: sanitizedDoc.queueSettings.enabled,
              maxActiveSessions: sanitizedDoc.queueSettings.maxActiveSessions,
              updatedAt: Date.now()
            },
            { merge: true }
        );
      }

      alert('설정이 저장되었습니다.');
    } catch (error) {
      console.error('Error saving settings:', error);
      alert('설정 저장 중 오류가 발생했습니다.');
    }
  };

  const handleLogout = async () => {
    try {
      await signOut();
      navigate('/admin/login');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const getReservationStatusColor = (status: Reservation['status']) => {
    switch (status) {
      case 'reserved': return 'border-amber-200 bg-amber-50 text-amber-800';
      case 'processing': return 'border-blue-200 bg-blue-50 text-blue-800';
      case 'confirmed': return 'border-emerald-200 bg-emerald-50 text-emerald-800';
      case 'expired': return 'border-rose-200 bg-rose-50 text-rose-800';
      default: return 'border-gray-200 bg-gray-50 text-gray-700';
    }
  };

  if (pageLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2 border-blue-600" />
          <p className="text-gray-600">학교 설정을 불러오는 중입니다.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <div className="sticky top-0 z-20 border-b bg-white/95 shadow-sm backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate('/admin/schools')} className="rounded-lg p-2 transition-colors hover:bg-gray-100">
              <ArrowLeft className="h-5 w-5 text-gray-600" />
            </button>
            <div>
              <h1 className="flex items-center text-2xl font-bold text-gray-900">
                <Settings className="mr-2 h-6 w-6 text-blue-600" />
                {watch('name') || schoolId}
              </h1>
              <p className="mt-1 text-sm text-gray-500">운영 현황 및 게이트 설정을 관리합니다.</p>
            </div>
          </div>
          <button onClick={handleLogout} className="flex items-center gap-2 rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium transition-colors hover:bg-gray-200">
            <LogOut className="h-4 w-4" />
            로그아웃
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 rounded-2xl bg-white shadow-sm overflow-hidden">
          <div className="border-b border-gray-100 px-6">
            <nav className="flex gap-6">
              {[
                { key: 'overview', label: '현황판', icon: Activity },
                { key: 'settings', label: '설정', icon: Settings },
                { key: 'reservations', label: '예약 현황', icon: Clock },
                { key: 'registrations', label: '등록 현황', icon: Users }
              ].map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setActiveTab(key as any)}
                  className={`flex items-center border-b-2 px-1 py-4 text-sm font-medium transition-colors ${
                    activeTab === key ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500'
                  }`}
                >
                  <Icon className="mr-2 h-4 w-4" />
                  {label}
                </button>
              ))}
            </nav>
          </div>
        </div>

        {activeTab === 'overview' && (
          <div className="space-y-6">
            <div className="rounded-3xl bg-white p-8 shadow-xl border border-gray-100">
              <div className="flex items-center justify-between mb-8">
                <h2 className="flex items-center text-xl font-bold text-gray-900">
                  <Activity className="mr-3 h-6 w-6 text-blue-600" />
                  실시간 수용 현황
                  {currentAdmissionRound && (
                    <span className="ml-3 rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-600">
                      {currentAdmissionRound.label} 모집 진행 중
                    </span>
                  )}
                </h2>
                <div className="text-xs text-gray-400 font-medium">최종 업데이트: {formatTime(slotStats?.lastUpdated || Date.now())}</div>
              </div>

              {slotStats ? (
                <>
                  <div className="grid gap-6 md:grid-cols-4">
                    <OverviewCard label="총 정원" value={slotStats.total} helper="관리 대상 전체 인원" tone="blue" />
                    <OverviewCard label="제출 완료" value={slotStats.confirmed} helper="확정 + 예비 순번 포함" tone="green" />
                    <OverviewCard label="작성 중" value={slotStats.reserved} helper="작성 세션 점유 중" tone="amber" />
                    <OverviewCard label="잔여석" value={slotStats.available} helper="현재 즉시 입장 가능" tone="violet" />
                  </div>

                  <div className="mt-10">
                    <div className="mb-3 flex justify-between text-sm font-bold text-gray-700">
                      <span>전체 진행률 (작성 중 포함)</span>
                      <span>{progressRate}%</span>
                    </div>
                    <div className="h-5 overflow-hidden rounded-full bg-gray-100 p-1">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-blue-500 via-indigo-500 to-violet-500 transition-all duration-700 shadow-lg"
                        style={{ width: `${progressRate}%` }}
                      />
                    </div>
                  </div>
                </>
              ) : (
                <div className="py-20 text-center">
                  <RefreshCw className="mx-auto mb-4 h-12 w-12 animate-spin text-blue-200" />
                  <p className="text-gray-400 font-medium">데이터를 실시간으로 연결하는 중입니다...</p>
                </div>
              )}
            </div>

            {/* Emergency Toolkit UI */}
            <div className="rounded-3xl border-2 border-rose-100 bg-white p-8 shadow-2xl">
              <div className="flex items-center justify-between mb-6">
                <h2 className="flex items-center text-xl font-bold text-rose-600">
                  <AlertTriangle className="mr-3 h-6 w-6" />
                  긴급 관리 도구 (Emergency Toolkit)
                </h2>
                <span className="text-[10px] bg-rose-50 text-rose-600 px-2 py-1 rounded font-bold">LIVE OVERRIDE ENABLED</span>
              </div>
              
              <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-4">
                  <p className="text-[11px] font-black uppercase tracking-widest text-gray-400">System Sync</p>
                  <div className="flex flex-col gap-3">
                    <button onClick={handleRecalculate} disabled={emergencyLoading} className="flex items-center justify-center gap-2 rounded-2xl bg-gray-900 px-5 py-3 text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50">
                      <RefreshCw className={`h-4 w-4 ${emergencyLoading ? 'animate-spin' : ''}`} />
                      수치 전면 재계산
                    </button>
                    <button onClick={handleCleanupStale} disabled={emergencyLoading} className="flex items-center justify-center gap-2 rounded-2xl border-2 border-gray-200 px-5 py-3 text-sm font-bold text-gray-700 hover:bg-gray-50 transition-all">
                      <Clock className="h-4 w-4" />
                      만료 세션 강제 정리
                    </button>
                  </div>
                </div>

                <div className="space-y-4">
                  <p className="text-[11px] font-black uppercase tracking-widest text-gray-400">Capacity Control</p>
                  <div className="flex gap-3">
                    <button onClick={() => handleQuickBoost(10)} disabled={emergencyLoading} className="flex-1 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white hover:bg-emerald-700 shadow-lg shadow-emerald-100 transition-all">+10</button>
                    <button onClick={() => handleQuickBoost(30)} disabled={emergencyLoading} className="flex-1 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white hover:bg-emerald-700 shadow-lg shadow-emerald-100 transition-all">+30</button>
                  </div>
                  <p className="text-[10px] text-gray-400 text-center font-medium">현지 정원을 즉시 늘립니다.</p>
                </div>

                <div className="space-y-4">
                  <p className="text-[11px] font-black uppercase tracking-widest text-gray-400">Admission Shift</p>
                  <div className="flex flex-col gap-3">
                    <div className="flex gap-2">
                      <button onClick={() => handleForceRoundSwitch('round1')} className={`flex-1 rounded-2xl py-3 text-xs font-bold transition-all ${activeForceRound === 'round1' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>1차</button>
                      <button onClick={() => handleForceRoundSwitch('round2')} className={`flex-1 rounded-2xl py-3 text-xs font-bold transition-all ${activeForceRound === 'round2' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>2차</button>
                    </div>
                    <button onClick={() => handleForceRoundSwitch(null)} className="rounded-2xl border-2 border-dashed border-gray-200 px-5 py-2 text-[11px] font-bold text-gray-400 hover:bg-gray-50">자동 모드 복구</button>
                  </div>
                </div>

                <div className="space-y-4">
                  <p className="text-[11px] font-black uppercase tracking-widest text-gray-400">Global Notice</p>
                  <div className="flex flex-col gap-3">
                    <input
                      type="text"
                      placeholder="긴급 공지 입력..."
                      className="rounded-2xl border-2 border-gray-100 bg-gray-50 px-4 py-3 text-sm focus:border-rose-500 focus:outline-none"
                      onChange={(e) => setValue('emergencyNotice' as any, { enabled: !!e.target.value, message: e.target.value })}
                      onBlur={() => handleSubmit(onSubmit)()}
                    />
                    <p className="text-[10px] text-gray-400 text-center leading-relaxed">입력 후 빈 배경 클릭 시<br/>사용자 배너가 즉시 노출됩니다.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Audit Log (Master only) */}
            {adminProfile?.role === 'MASTER' && auditLogs.length > 0 && (
              <div className="rounded-3xl bg-white p-8 shadow-sm border border-gray-100">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-lg font-bold text-gray-900">최근 관리자 활동 (Audit Log)</h2>
                    <span className="text-[10px] font-bold text-gray-400">최근 10개 항목</span>
                </div>
                <div className="space-y-4">
                  {auditLogs.map(log => (
                    <div key={log.id} className="flex items-center justify-between py-1 border-b border-gray-50 last:border-0 pb-4">
                      <div>
                        <p className="text-sm font-bold text-gray-800">{log.action}</p>
                        <p className="text-xs text-gray-400 mt-1">{log.adminEmail} · {formatTime(log.timestamp)}</p>
                      </div>
                      <div className="text-[10px] bg-slate-50 px-3 py-1.5 rounded-lg text-slate-500 font-mono border border-slate-100">{log.id.slice(-6)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="rounded-3xl bg-white p-8 shadow-xl border border-gray-100">
            <h2 className="mb-8 flex items-center text-xl font-bold text-gray-900">
              <Settings className="mr-3 h-6 w-6 text-blue-600" />
              기본 정보 및 운영 설정
            </h2>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-12">
              <section>
                <h3 className="mb-6 flex items-center text-md font-bold text-gray-800">
                  <span className="mr-3 flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-xs text-blue-600">1</span>
                  행사 기본 정보
                </h3>
                <div className="grid gap-6 md:grid-cols-2">
                  <Field label="행사명"><input {...register('name', { required: true })} type="text" className={inputClassName} /></Field>
                  <Field label="로고 URL"><input {...register('logoUrl')} type="url" className={inputClassName} /></Field>
                  <Field label="1차 오픈 시간"><input {...register('admissionRounds.0.openDateTime', { required: true })} type="datetime-local" className={inputClassName} /></Field>
                  <Field label="2차 오픈 시간"><input {...register('admissionRounds.1.openDateTime')} type="datetime-local" className={inputClassName} /></Field>
                  <Field label="행사 일자" hint="선택 사항"><input {...register('eventDate')} type="date" className={inputClassName} /></Field>
                  <Field label="게이트 대표 안내문">
                    <textarea {...register('heroMessage')} rows={3} className={textareaClassName} placeholder="오픈 일시 및 입장 방법 안내..." />
                  </Field>
                </div>
              </section>

              <section>
                <h3 className="mb-6 flex items-center text-md font-bold text-gray-800">
                  <span className="mr-3 flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-xs text-emerald-600">2</span>
                  모집 정원 및 대기열
                </h3>
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-5">
                  <Field label="1차 정규"><input {...register('admissionRounds.0.maxCapacity', { required: true, valueAsNumber: true })} type="number" className={inputClassName} /></Field>
                  <Field label="1차 예비"><input {...register('admissionRounds.0.waitlistCapacity', { required: true, valueAsNumber: true })} type="number" className={inputClassName} /></Field>
                  <Field label="2차 정규"><input {...register('admissionRounds.1.maxCapacity', { valueAsNumber: true })} type="number" className={inputClassName} /></Field>
                  <Field label="2차 예비"><input {...register('admissionRounds.1.waitlistCapacity', { valueAsNumber: true })} type="number" className={inputClassName} /></Field>
                  <Field label="동시 작성 정원" hint="60권장"><input {...register('queueSettings.maxActiveSessions', { required: true, valueAsNumber: true })} type="number" className={inputClassName} /></Field>
                </div>
                <div className="mt-8 flex flex-wrap gap-4">
                  <label className="flex items-center gap-3 rounded-2xl border-2 border-gray-100 px-6 py-4 transition-all hover:bg-gray-50">
                    <input {...register('admissionRounds.1.enabled')} type="checkbox" className="h-5 w-5 border-2" />
                    <span className="text-sm font-bold text-gray-700">2차 모집 활성화</span>
                  </label>
                  <label className="flex items-center gap-3 rounded-2xl border-2 border-gray-100 px-6 py-4 transition-all hover:bg-gray-50">
                    <input {...register('queueSettings.enabled')} type="checkbox" className="h-5 w-5 border-2" />
                    <span className="text-sm font-bold text-gray-700">대기열 엔진 사용</span>
                  </label>
                  <label className="flex items-center gap-3 rounded-2xl border-2 border-gray-100 px-6 py-4 transition-all hover:bg-gray-50">
                    <input {...register('isActive')} type="checkbox" className="h-5 w-5 border-2" />
                    <span className="text-sm font-bold text-gray-700">공개 페이지 활성</span>
                  </label>
                </div>
              </section>

              <section>
                <h3 className="mb-6 flex items-center text-md font-bold text-gray-800">
                  <span className="mr-3 flex h-6 w-6 items-center justify-center rounded-full bg-rose-100 text-xs text-rose-600">3</span>
                  긴급 제어 및 세션 설정
                </h3>
                <div className="grid gap-6 md:grid-cols-2">
                  <Field label="긴급 공지 메시지" hint="활성화 시 모든 사용자 게이트 상단에 노출됩니다.">
                    <input {...register('emergencyNotice.message')} type="text" className={inputClassName} placeholder="예: 현재 접속자가 많아 지연되고 있습니다." />
                  </Field>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="작성 제한 시간 (분)" hint="기본 3분"><input {...register('sessionTimeoutSettings.activeSessionTimeoutMs', { valueAsNumber: true })} type="number" className={inputClassName} /></Field>
                    <Field label="입장 유예 시간 (초)" hint="기본 90초"><input {...register('sessionTimeoutSettings.gracePeriodMs', { valueAsNumber: true })} type="number" className={inputClassName} /></Field>
                  </div>
                </div>
                <div className="mt-6 flex flex-wrap gap-4">
                  <label className="flex items-center gap-3 rounded-2xl border-2 border-gray-100 px-6 py-4 transition-all hover:bg-gray-50">
                    <input {...register('emergencyNotice.enabled')} type="checkbox" className="h-5 w-5 border-2" />
                    <span className="text-sm font-bold text-gray-700">긴급 공지 즉시 활성화</span>
                  </label>
                </div>
              </section>

              <section>
                <h3 className="mb-6 flex items-center text-md font-bold text-gray-800">
                  <span className="mr-3 flex h-6 w-6 items-center justify-center rounded-full bg-violet-100 text-xs text-violet-600">4</span>
                  NHN 알림톡 연동
                </h3>
                <div className="flex gap-3 mb-6">
                  <button type="button" onClick={handleLoadTemplates} disabled={loadingTemplates} className="rounded-2xl bg-gray-900 px-6 py-3 text-sm font-bold text-white hover:bg-gray-800 disabled:opacity-50 transition-all">
                    {loadingTemplates ? <RefreshCw className="h-4 w-4 animate-spin mr-2" /> : <Search className="h-4 w-4 mr-2" />}
                    {loadingTemplates ? '로드 중...' : 'NHN 템플릿 로드'}
                  </button>
                  <input {...register('alimtalkSettings.nhnAppKey')} placeholder="App Key" className="rounded-2xl border-2 border-gray-100 px-4 py-2 text-sm flex-1" />
                  <input {...register('alimtalkSettings.nhnSecretKey')} type="password" placeholder="Secret Key" className="rounded-2xl border-2 border-gray-100 px-4 py-2 text-sm flex-1" />
                </div>
                <div className="grid gap-8 lg:grid-cols-3">
                  <div className="space-y-4">
                    <p className="text-sm font-bold text-gray-700">성공 알림 (Confirmed)</p>
                    <select value={watchedSuccessTemplate} onChange={(e) => applyTemplate('success', e.target.value)} className={selectClassName}>
                      <option value="">템플릿 선택</option>
                      {templateOptions.map(t => <option key={t.templateCode} value={t.templateCode}>{t.templateName}</option>)}
                    </select>
                    <TemplatePreview template={selectedSuccessTemplate} />
                  </div>
                  <div className="space-y-4">
                    <p className="text-sm font-bold text-gray-700">예비 알림 (Waitlisted)</p>
                    <select value={watchedWaitlistTemplate} onChange={(e) => applyTemplate('waitlist', e.target.value)} className={selectClassName}>
                      <option value="">템플릿 선택</option>
                      {templateOptions.map(t => <option key={t.templateCode} value={t.templateCode}>{t.templateName}</option>)}
                    </select>
                    <TemplatePreview template={selectedWaitlistTemplate} />
                  </div>
                  <div className="space-y-4">
                    <p className="text-sm font-bold text-gray-700">승급 알림 (Promoted)</p>
                    <select value={watchedPromoteTemplate} onChange={(e) => applyTemplate('promote', e.target.value)} className={selectClassName}>
                      <option value="">템플릿 선택</option>
                      {templateOptions.map(t => <option key={t.templateCode} value={t.templateCode}>{t.templateName}</option>)}
                    </select>
                    <TemplatePreview template={selectedPromoteTemplate} />
                  </div>
                </div>
              </section>

              <div className="flex justify-end gap-4 pt-10 border-t">
                <button type="submit" className="flex items-center gap-2 rounded-2xl bg-blue-600 px-10 py-4 text-lg font-black text-white hover:bg-blue-700 shadow-xl shadow-blue-100 transition-all active:scale-95">
                  <Save className="h-6 w-6" />
                  전체 설정 저장
                </button>
              </div>

              {adminProfile?.role === 'MASTER' && (
                <div className="mt-20 rounded-3xl border-2 border-rose-100 bg-rose-50/20 p-8">
                  <h4 className="flex items-center gap-2 text-rose-600 font-bold mb-4">
                    <AlertTriangle className="h-5 w-5" /> MASTER ONLY: DANGER ZONE
                  </h4>
                  <div className="flex items-center justify-between bg-white p-6 rounded-2xl border border-rose-100 shadow-sm">
                    <div>
                      <p className="font-bold text-gray-900">학교 데이터 전체 초기화</p>
                      <p className="text-xs text-gray-400 mt-1">모집 내역, 큐, 감사로그 등 모든 서브컬렉션을 삭제합니다. (복구 불가)</p>
                    </div>
                    <button type="button" onClick={handleFullReset} disabled={resetting} className="rounded-2xl bg-rose-600 px-6 py-3 font-bold text-white hover:bg-rose-700 disabled:opacity-50 transition-all">
                      {resetting ? '초기화 진행 중...' : '데이터 전면 삭제'}
                    </button>
                  </div>
                </div>
              )}
            </form>
          </div>
        )}

        {activeTab === 'reservations' && (
          <div className="rounded-3xl bg-white p-8 shadow-xl border border-gray-100">
            <div className="mb-8 flex items-center justify-between">
              <h2 className="flex items-center text-xl font-bold text-gray-900">
                <Clock className="mr-3 h-6 w-6 text-blue-600" />
                실시간 세션 현황
              </h2>
              <button onClick={() => loadReservations()} className="flex items-center gap-2 rounded-2xl bg-gray-100 px-6 py-3 text-sm font-bold hover:bg-gray-200 transition-all">
                <RefreshCw className="h-4 w-4" /> 새로고침
              </button>
            </div>
            
            {loadingReservations ? (
              <div className="py-20 text-center"><RefreshCw className="mx-auto h-12 w-12 animate-spin text-blue-100" /></div>
            ) : reservations.length === 0 ? (
              <div className="py-20 text-center text-gray-300 font-bold">활성화된 세션이 없습니다.</div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-gray-100">
                <table className="min-w-full divide-y divide-gray-100">
                  <thead className="bg-gray-50">
                    <tr>{['상태', 'ID 하시', '개시 시간', '남은 시간'].map(h => <th key={h} className="px-6 py-4 text-left text-xs font-black text-gray-400 uppercase tracking-widest">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 bg-white">
                    {reservations.map(res => {
                       const minutesLeft = Math.floor(Math.max(0, (res.expiresAt || 0) - Date.now()) / 60000);
                       return (
                        <tr key={res.id} className="hover:bg-gray-50/50 transition-colors">
                          <td className="px-6 py-4"><span className={`inline-flex rounded-full px-3 py-1 text-[10px] font-black uppercase ${getReservationStatusColor(res.status)}`}>{res.status}</span></td>
                          <td className="px-6 py-4 text-sm font-mono text-gray-500">{(res.userId || '').slice(0, 10)}...</td>
                          <td className="px-6 py-4 text-sm text-gray-400">{formatTime(res.createdAt || Date.now())}</td>
                          <td className="px-6 py-4 text-sm font-bold">{res.status === 'reserved' ? <span className={minutesLeft <= 1 ? 'text-rose-500' : 'text-emerald-500'}>{minutesLeft}분</span> : '-'}</td>
                        </tr>
                       );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'registrations' && (
          <div className="rounded-3xl bg-white p-8 shadow-xl border border-gray-100">
            <h2 className="mb-6 flex items-center text-xl font-bold text-gray-900">
              <Users className="mr-3 h-6 w-6 text-blue-600" />
              최종 등록 리스트
            </h2>
            <RegistrationList schoolId={schoolId!} />
          </div>
        )}
      </div>
    </div>
  );
}
