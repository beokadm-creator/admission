import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { onValue, ref } from 'firebase/database';
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
import { db, functions, rtdb } from '../../firebase/config';
import RegistrationList from '../../components/RegistrationList';
import { useAuth } from '../../contexts/AuthContext';
import { SchoolConfig } from '../../types/models';

interface SlotStats {
  total: number;
  reserved: number;
  confirmed: number;
  available: number;
  lastUpdated: number;
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

  const { register, handleSubmit, setValue, watch } = useForm<SettingsFormValues>({
    defaultValues: {
      id: '',
      name: '',
      logoUrl: '',
      maxCapacity: 950,
      waitlistCapacity: 50,
      openDateTime: '',
      eventDate: '',
      heroMessage: '',
      programInfo: '',
      parkingMessage: '',
      usePopup: false,
      popupContent: '',
      programImageUrl: '',
      previewToken: '',
      queueSettings: {
        enabled: true,
        batchSize: 80,
        batchInterval: 60
      },
      formFields: {
        collectEmail: false,
        collectAddress: false,
        collectSchoolName: false,
        collectGrade: false,
        collectStudentId: false,
        gradeOptionsText: ''
      },
      alimtalkSettings: {
        nhnAppKey: '',
        nhnSecretKey: '',
        nhnSenderKey: '',
        successTemplate: '',
        waitlistTemplate: '',
        promoteTemplate: '',
        confirmTemplateCode: '',
        waitlistTemplateCode: ''
      },
      buttonSettings: {
        showLookupButton: true,
        showCancelButton: true
      },
      terms: {
        privacy: { title: '', content: '', required: true },
        thirdParty: { title: '', content: '', required: true },
        sms: { title: '', content: '', required: true }
      },
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
  });

  const watchedRegularCapacity = watch('maxCapacity') || 0;
  const watchedWaitlistCapacity = watch('waitlistCapacity') || 0;
  const watchedBatchSize = watch('queueSettings.batchSize') || 0;
  const watchedBatchIntervalSeconds = watch('queueSettings.batchInterval') || 0;
  const watchedNhnAppKey = watch('alimtalkSettings.nhnAppKey') || '';
  const watchedNhnSecretKey = watch('alimtalkSettings.nhnSecretKey') || '';
  const watchedSuccessTemplate = watch('alimtalkSettings.successTemplate') || '';
  const watchedWaitlistTemplate = watch('alimtalkSettings.waitlistTemplate') || '';
  const watchedPromoteTemplate = watch('alimtalkSettings.promoteTemplate') || '';
  const totalManagedCapacity = watchedRegularCapacity + watchedWaitlistCapacity;
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
        const heroMessage = data.heroMessage || data.parkingMessage || '';
        const queueBatchIntervalSeconds = data.queueSettings?.batchInterval
          ? Math.max(1, Math.round(data.queueSettings.batchInterval / 1000))
          : 60;

        setValue('id', schoolId);
        setValue('name', data.name || '');
        setValue('logoUrl', data.logoUrl || '');
        setValue('maxCapacity', data.maxCapacity || 0);
        setValue('waitlistCapacity', data.waitlistCapacity || 0);
        setValue('openDateTime', toLocalDateTimeValue(data.openDateTime));
        setValue('eventDate', data.eventDate ? data.eventDate.slice(0, 10) : '');
        setValue('heroMessage', heroMessage);
        setValue('programInfo', data.programInfo || '');
        setValue('parkingMessage', heroMessage);
        setValue('usePopup', !!data.usePopup);
        setValue('popupContent', data.popupContent || '');
        setValue('previewToken', data.previewToken || '');
        setValue('queueSettings.enabled', data.queueSettings?.enabled !== false);
        setValue('queueSettings.batchSize', data.queueSettings?.batchSize || 80);
        setValue('queueSettings.batchInterval', queueBatchIntervalSeconds);
        setValue('formFields.collectEmail', !!data.formFields?.collectEmail);
        setValue('formFields.collectAddress', !!data.formFields?.collectAddress);
        setValue('formFields.collectSchoolName', !!data.formFields?.collectSchoolName);
        setValue('formFields.collectGrade', !!data.formFields?.collectGrade);
        setValue('formFields.collectStudentId', !!data.formFields?.collectStudentId);
        setValue('alimtalkSettings.nhnAppKey', data.alimtalkSettings?.nhnAppKey || '');
        setValue('alimtalkSettings.nhnSecretKey', data.alimtalkSettings?.nhnSecretKey || '');
        setValue('alimtalkSettings.nhnSenderKey', data.alimtalkSettings?.nhnSenderKey || '');
        setValue(
          'alimtalkSettings.successTemplate',
          data.alimtalkSettings?.successTemplate || data.alimtalkSettings?.confirmTemplateCode || ''
        );
        setValue(
          'alimtalkSettings.waitlistTemplate',
          data.alimtalkSettings?.waitlistTemplate || data.alimtalkSettings?.waitlistTemplateCode || ''
        );
        setValue('alimtalkSettings.promoteTemplate', data.alimtalkSettings?.promoteTemplate || '');
        setValue(
          'alimtalkSettings.confirmTemplateCode',
          data.alimtalkSettings?.confirmTemplateCode || data.alimtalkSettings?.successTemplate || ''
        );
        setValue(
          'alimtalkSettings.waitlistTemplateCode',
          data.alimtalkSettings?.waitlistTemplateCode || data.alimtalkSettings?.waitlistTemplate || ''
        );
        setValue('buttonSettings.showLookupButton', data.buttonSettings?.showLookupButton !== false);
        setValue('buttonSettings.showCancelButton', data.buttonSettings?.showCancelButton !== false);
        setValue('isActive', data.isActive !== false);
        setValue('programImageUrl', data.programImageUrl || '');
        setValue('formFields.gradeOptionsText', (data.formFields?.gradeOptions || []).join('\n'));
      } catch (error) {
        console.error('Error loading school settings:', error);
        alert('학교 설정을 불러오는 중 오류가 발생했습니다.');
      } finally {
        setPageLoading(false);
      }
    };

    void loadSchool();
  }, [adminProfile, navigate, schoolId, setValue]);

  useEffect(() => {
    if (!schoolId) return;

    const slotsRef = ref(rtdb, `slots/${schoolId}`);
    const unsubscribe = onValue(
      slotsRef,
      (snapshot) => {
        if (snapshot.exists()) {
          setSlotStats(snapshot.val() as SlotStats);
          return;
        }

        setSlotStats(emptySlotStats(watchedRegularCapacity + watchedWaitlistCapacity));
      },
      (error) => {
        console.error('Error fetching slot stats:', error);
        setSlotStats(emptySlotStats(watchedRegularCapacity + watchedWaitlistCapacity));
      }
    );

    return unsubscribe;
  }, [schoolId, watchedRegularCapacity, watchedWaitlistCapacity]);

  useEffect(() => {
    if (activeTab === 'reservations' && schoolId) {
      void loadReservations();
    }
  }, [activeTab, schoolId]);

  const progressRate = useMemo(() => {
    if (!slotStats?.total) return 0;
    return Math.min(100, Math.round(((slotStats.confirmed + slotStats.reserved) / slotStats.total) * 100));
  }, [slotStats]);

  const loadReservations = async () => {
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
  };

  const handleLoadTemplates = async () => {
    if (!watchedNhnAppKey.trim() || !watchedNhnSecretKey.trim()) {
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
        setTemplateLoadSuccess('조회는 완료됐지만 불러온 템플릿이 없습니다. NHN 콘솔에 승인된 템플릿이 있는지 확인해 주세요.');
      } else {
        setTemplateLoadSuccess(`${templates.length.toLocaleString()}개의 템플릿을 불러왔습니다.`);
      }
    } catch (error: any) {
      console.error('Error loading NHN AlimTalk templates:', error);
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
      const batchIntervalMs = Math.max(1000, (data.queueSettings?.batchInterval || 60) * 1000);
      const total = (data.maxCapacity || 0) + (data.waitlistCapacity || 0);
      const successTemplate =
        data.alimtalkSettings?.successTemplate?.trim() || data.alimtalkSettings?.confirmTemplateCode?.trim() || '';
      const waitlistTemplate =
        data.alimtalkSettings?.waitlistTemplate?.trim() || data.alimtalkSettings?.waitlistTemplateCode?.trim() || '';
      const promoteTemplate = data.alimtalkSettings?.promoteTemplate?.trim() || '';
      const sanitizedDoc = {
        ...data,
        id: schoolId,
        openDateTime: toIsoDateTime(data.openDateTime),
        eventDate: data.eventDate || '',
        heroMessage: heroCopy,
        parkingMessage: heroCopy,
        programInfo: programCopy,
        programImageUrl: data.programImageUrl || '',
        popupContent: data.popupContent || '',
        previewToken: data.previewToken || '',
        queueSettings: {
          enabled: data.queueSettings?.enabled !== false,
          batchSize: data.queueSettings?.batchSize || 80,
          batchInterval: batchIntervalMs
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
          ...data.alimtalkSettings,
          nhnAppKey: data.alimtalkSettings?.nhnAppKey?.trim() || '',
          nhnSecretKey: data.alimtalkSettings?.nhnSecretKey?.trim() || '',
          nhnSenderKey: data.alimtalkSettings?.nhnSenderKey?.trim() || '',
          successTemplate,
          waitlistTemplate,
          promoteTemplate,
          confirmTemplateCode: successTemplate,
          waitlistTemplateCode: waitlistTemplate
        },
        updatedAt: Date.now()
      };

      await setDoc(doc(db, 'schools', schoolId), sanitizedDoc, { merge: true });

      const syncSlots = httpsCallable(functions, 'syncSchoolSlots');
      await syncSlots({ schoolId, total });

      alert('설정이 저장되었습니다.');
    } catch (error) {
      console.error('Error saving school settings:', error);
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
      case 'reserved':
        return 'border-amber-200 bg-amber-50 text-amber-800';
      case 'processing':
        return 'border-blue-200 bg-blue-50 text-blue-800';
      case 'confirmed':
        return 'border-emerald-200 bg-emerald-50 text-emerald-800';
      case 'expired':
        return 'border-rose-200 bg-rose-50 text-rose-800';
      default:
        return 'border-gray-200 bg-gray-50 text-gray-700';
    }
  };

  if (pageLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2 border-blue-600" />
          <p className="text-gray-600">학교 설정을 불러오는 중입니다.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="sticky top-0 z-10 border-b bg-white/95 shadow-sm backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/admin/schools')}
              className="rounded-lg p-2 transition-colors hover:bg-gray-100"
            >
              <ArrowLeft className="h-5 w-5 text-gray-600" />
            </button>
            <div>
              <h1 className="flex items-center text-2xl font-bold text-gray-900">
                <Settings className="mr-2 h-6 w-6 text-blue-600" />
                {schoolId}
              </h1>
              <p className="mt-1 text-sm text-gray-500">게이트 안내, 정원, 대기열 설정을 관리합니다.</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium transition-colors hover:bg-gray-200"
          >
            <LogOut className="h-4 w-4" />
            로그아웃
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 rounded-2xl bg-white shadow-sm">
          <div className="border-b border-gray-200 px-6">
            <nav className="flex flex-wrap gap-6" aria-label="Tabs">
              {[
                { key: 'overview', label: '현황판', icon: Activity },
                { key: 'settings', label: '설정', icon: Settings },
                { key: 'reservations', label: '예약 현황', icon: Clock },
                { key: 'registrations', label: '등록 현황', icon: Users }
              ].map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setActiveTab(key as typeof activeTab)}
                  className={`flex items-center border-b-2 px-1 py-4 text-sm font-medium transition-colors ${
                    activeTab === key
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
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
            <div className="rounded-2xl bg-white p-6 shadow-sm">
              <h2 className="mb-4 flex items-center text-lg font-semibold text-gray-900">
                <Activity className="mr-2 h-5 w-5 text-blue-600" />
                실시간 수용 현황
              </h2>

              {slotStats ? (
                <>
                  <div className="grid gap-4 md:grid-cols-4">
                    <OverviewCard label="총 관리 인원" value={slotStats.total} helper="정규 신청 + 예비 접수" tone="blue" />
                    <OverviewCard label="작성 완료" value={slotStats.confirmed} helper="제출 완료된 신청" tone="green" />
                    <OverviewCard label="작성 중" value={slotStats.reserved} helper="신청서 작성 페이지 접속 인원" tone="amber" />
                    <OverviewCard label="잔여 인원" value={slotStats.total - slotStats.confirmed} helper="최종 제출 전인 모든 잔여 인원" tone="violet" />
                  </div>

                  <div className="mt-6">
                    <div className="mb-2 flex justify-between text-sm text-gray-600">
                      <span>진행률</span>
                      <span>{progressRate}%</span>
                    </div>
                    <div className="h-4 overflow-hidden rounded-full bg-gray-200">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-blue-500 to-violet-500 transition-all duration-500"
                        style={{ width: `${progressRate}%` }}
                      />
                    </div>
                  </div>
                </>
              ) : (
                <div className="py-8 text-center text-gray-500">
                  <RefreshCw className="mx-auto mb-2 h-8 w-8 animate-spin" />
                  실시간 현황을 불러오는 중입니다.
                </div>
              )}
            </div>

            <div className="rounded-2xl bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-lg font-semibold text-gray-900">현재 운영 설정 요약</h2>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <SummaryCard title="정규 신청 인원" value={`${watchedRegularCapacity.toLocaleString()}명`} />
                <SummaryCard title="예비 접수 인원" value={`${watchedWaitlistCapacity.toLocaleString()}명`} />
                <SummaryCard title="순차 입장 설정" value={`${watchedBatchSize.toLocaleString()}명 / ${watchedBatchIntervalSeconds}초`} />
                <SummaryCard title="총 관리 인원" value={`${totalManagedCapacity.toLocaleString()}명`} />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <h2 className="mb-6 flex items-center text-lg font-semibold text-gray-900">
              <Settings className="mr-2 h-5 w-5 text-blue-600" />
              게이트 및 접수 설정
            </h2>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
              <section className="border-b pb-6">
                <h3 className="mb-4 text-base font-semibold text-gray-900">행사 기본 정보</h3>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="행사명">
                    <input {...register('name', { required: true })} type="text" className={inputClassName} />
                  </Field>
                  <Field label="로고 이미지 URL">
                    <input {...register('logoUrl')} type="url" className={inputClassName} />
                  </Field>
                  <Field label="오픈 일시">
                    <input {...register('openDateTime', { required: true })} type="datetime-local" className={inputClassName} />
                  </Field>
                  <Field label="행사 일자">
                    <input {...register('eventDate')} type="date" className={inputClassName} />
                  </Field>
                  <Field label="게이트 대표 안내문">
                    <textarea
                      {...register('heroMessage')}
                      rows={4}
                      className={textareaClassName}
                      placeholder="예: 오픈 시각에 버튼이 활성화되며, 클릭 순서대로 순번이 부여됩니다."
                    />
                  </Field>
                  <Field label="프로그램 안내 (텍스트)">
                    <textarea
                      {...register('programInfo')}
                      rows={4}
                      className={textareaClassName}
                      placeholder="예: 사전 준비물, 행사 소개, 유의사항 등을 안내합니다."
                    />
                  </Field>
                  <Field label="프로그램 안내 이미지 URL" hint="게이트 페이지의 '프로그램 보기' 팝업에 노출될 이미지 주소입니다.">
                    <input {...register('programImageUrl')} type="url" className={inputClassName} placeholder="https://..." />
                  </Field>
                </div>
              </section>

              <section className="border-b pb-6">
                <h3 className="mb-4 text-base font-semibold text-gray-900">모집 및 대기열 설정</h3>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <Field label="정규 신청 인원">
                    <input
                      {...register('maxCapacity', { required: true, valueAsNumber: true })}
                      type="number"
                      min={0}
                      className={inputClassName}
                    />
                  </Field>
                  <Field label="예비 접수 인원">
                    <input
                      {...register('waitlistCapacity', { required: true, valueAsNumber: true })}
                      type="number"
                      min={0}
                      className={inputClassName}
                    />
                  </Field>
                  <Field label="한 번에 입장시킬 인원">
                    <input
                      {...register('queueSettings.batchSize', { required: true, valueAsNumber: true })}
                      type="number"
                      min={1}
                      className={inputClassName}
                    />
                  </Field>
                  <Field label="배치 간격(초)">
                    <input
                      {...register('queueSettings.batchInterval', { required: true, valueAsNumber: true })}
                      type="number"
                      min={1}
                      className={inputClassName}
                    />
                  </Field>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <label className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <input
                      {...register('queueSettings.enabled')}
                      type="checkbox"
                      className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm font-medium text-gray-700">대기열 기능 사용</span>
                  </label>
                  <label className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <input
                      {...register('isActive')}
                      type="checkbox"
                      className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm font-medium text-gray-700">학교 페이지 활성화</span>
                  </label>
                </div>
              </section>

              <section className="border-b pb-6">
                <h3 className="mb-4 text-base font-semibold text-gray-900">수집 정보 및 버튼 설정</h3>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-3 rounded-2xl border border-gray-200 p-4">
                    <p className="text-sm font-semibold text-gray-900">추가 수집 항목</p>
                    {[
                      { key: 'collectStudentId', label: '학번' },
                      { key: 'collectEmail', label: '이메일' },
                      { key: 'collectSchoolName', label: '학교명' },
                      { key: 'collectGrade', label: '학년' },
                      { key: 'collectAddress', label: '주소' }
                    ].map(({ key, label }) => (
                      <label key={key} className="flex items-center gap-3">
                        <input
                          {...register(`formFields.${key}` as any)}
                          type="checkbox"
                          className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-sm text-gray-700">{label} 수집</span>
                      </label>
                    ))}

                    <div className="mt-4 pt-4 border-t border-gray-100">
                      <Field label="학년 선택 옵션" hint="Enter를 눌러 한 줄에 하나씩 입력해 주세요. (예: 예비1학년)">
                        <textarea
                          {...register('formFields.gradeOptionsText' as any)}
                          rows={4}
                          className={textareaClassName}
                          placeholder="예비1학년&#10;예비2학년&#10;예비3학년"
                        />
                      </Field>
                    </div>
                  </div>

                  <div className="space-y-3 rounded-2xl border border-gray-200 p-4">
                    <p className="text-sm font-semibold text-gray-900">화면 버튼 노출</p>
                    <label className="flex items-center gap-3">
                      <input
                        {...register('buttonSettings.showLookupButton')}
                        type="checkbox"
                        className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-700">조회 버튼 노출</span>
                    </label>
                    <label className="flex items-center gap-3">
                      <input
                        {...register('buttonSettings.showCancelButton')}
                        type="checkbox"
                        className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-700">취소 버튼 노출</span>
                    </label>
                  </div>
                </div>
              </section>

              <section className="border-b pb-6">
                <h3 className="mb-4 text-base font-semibold text-gray-900 flex items-center gap-2">
                  <CheckSquare className="h-5 w-5 text-blue-600" />
                  이용 약관 설정
                </h3>
                <div className="grid gap-6">
                  {/* Privacy Policy */}
                  <div className="rounded-2xl border border-gray-200 p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <p className="font-bold text-gray-900 text-sm">개인정보 수집 및 이용 동의 (필수)</p>
                      <label className="flex items-center gap-2 text-xs text-gray-500">
                        <input {...register('terms.privacy.required')} type="checkbox" className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                        필수 동의 항목으로 설정
                      </label>
                    </div>
                    <Field label="약관 제목">
                      <input {...register('terms.privacy.title')} type="text" className={inputClassName} placeholder="예: [필수] 개인정보 수집 및 이용 동의" />
                    </Field>
                    <Field label="약관 내용">
                      <textarea {...register('terms.privacy.content')} rows={5} className={textareaClassName} placeholder="약관 내용을 입력해 주세요." />
                    </Field>
                  </div>

                  {/* Third Party Consent */}
                  <div className="rounded-2xl border border-gray-200 p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <p className="font-bold text-gray-900 text-sm">개인정보 제3자 제공 동의 (필수)</p>
                      <label className="flex items-center gap-2 text-xs text-gray-500">
                        <input {...register('terms.thirdParty.required')} type="checkbox" className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                        필수 동의 항목으로 설정
                      </label>
                    </div>
                    <Field label="약관 제목">
                      <input {...register('terms.thirdParty.title')} type="text" className={inputClassName} placeholder="예: [필수] 개인정보 제3자 제공 동의" />
                    </Field>
                    <Field label="약관 내용">
                      <textarea {...register('terms.thirdParty.content')} rows={5} className={textareaClassName} placeholder="약관 내용을 입력해 주세요." />
                    </Field>
                  </div>

                  {/* SMS Consent */}
                  <div className="rounded-2xl border border-gray-200 p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <p className="font-bold text-gray-900 text-sm">알림톡 및 문자 수신 동의 (필수 어뷰징 주의)</p>
                      <label className="flex items-center gap-2 text-xs text-gray-500">
                        <input {...register('terms.sms.required')} type="checkbox" className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                        필수 동의 항목으로 설정
                      </label>
                    </div>
                    <Field label="약관 제목">
                      <input {...register('terms.sms.title')} type="text" className={inputClassName} placeholder="예: [필수] 알림톡 및 문자 수신 동의" />
                    </Field>
                    <Field label="약관 내용">
                      <textarea {...register('terms.sms.content')} rows={5} className={textareaClassName} placeholder="약관 내용을 입력해 주세요." />
                    </Field>
                  </div>
                </div>
              </section>

              <section className="border-b pb-6">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-gray-900">NHN 알림톡 설정</h3>
                    <p className="mt-1 text-sm text-gray-500">
                      NHN 인증 정보를 입력한 뒤 템플릿 목록을 불러와 확정, 예비 접수, 승급 템플릿에 바로 적용할 수 있습니다.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleLoadTemplates}
                    disabled={loadingTemplates}
                    className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
                  >
                    {loadingTemplates ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    {loadingTemplates ? '템플릿 조회 중...' : '템플릿 불러오기'}
                  </button>
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-3">
                  <Field label="NHN App Key" hint="템플릿 조회와 연동 확인에 사용하는 App Key입니다.">
                    <input {...register('alimtalkSettings.nhnAppKey')} type="text" className={inputClassName} />
                  </Field>
                  <Field label="NHN Secret Key" hint="템플릿 목록 조회 callable에서 사용됩니다.">
                    <input {...register('alimtalkSettings.nhnSecretKey')} type="password" className={inputClassName} />
                  </Field>
                  <Field label="NHN Sender Key" hint="실제 발송 시 사용하는 카카오 채널 Sender Key입니다.">
                    <input {...register('alimtalkSettings.nhnSenderKey')} type="text" className={inputClassName} />
                  </Field>
                </div>

                {templateLoadError && (
                  <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                    {templateLoadError}
                  </div>
                )}
                {templateLoadSuccess && (
                  <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
                    {templateLoadSuccess}
                  </div>
                )}

                <div className="mt-6 grid gap-6 xl:grid-cols-3">
                  <div className="space-y-3 rounded-2xl border border-gray-200 p-5">
                    <div className="flex items-center gap-2 text-gray-900">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      <p className="font-semibold">확정 알림 템플릿</p>
                    </div>
                    <Field label="템플릿 선택">
                      <select
                        value={watchedSuccessTemplate}
                        onChange={(event) => applyTemplate('success', event.target.value)}
                        className={selectClassName}
                      >
                        <option value="">템플릿을 선택해 주세요</option>
                        {templateOptions.map((item) => (
                          <option key={`success-${item.templateCode}`} value={item.templateCode}>
                            {item.templateName} ({item.templateCode})
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="템플릿 코드 직접 입력">
                      <input
                        {...register('alimtalkSettings.successTemplate')}
                        type="text"
                        className={inputClassName}
                        onChange={(event) => {
                          setValue('alimtalkSettings.successTemplate', event.target.value);
                          setValue('alimtalkSettings.confirmTemplateCode', event.target.value);
                        }}
                      />
                    </Field>
                    <TemplatePreview template={selectedSuccessTemplate} />
                  </div>

                  <div className="space-y-3 rounded-2xl border border-gray-200 p-5">
                    <div className="flex items-center gap-2 text-gray-900">
                      <Users className="h-4 w-4 text-amber-600" />
                      <p className="font-semibold">예비 접수 템플릿</p>
                    </div>
                    <Field label="템플릿 선택">
                      <select
                        value={watchedWaitlistTemplate}
                        onChange={(event) => applyTemplate('waitlist', event.target.value)}
                        className={selectClassName}
                      >
                        <option value="">템플릿을 선택해 주세요</option>
                        {templateOptions.map((item) => (
                          <option key={`wait-${item.templateCode}`} value={item.templateCode}>
                            {item.templateName} ({item.templateCode})
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="템플릿 코드 직접 입력">
                      <input
                        {...register('alimtalkSettings.waitlistTemplate')}
                        type="text"
                        className={inputClassName}
                        onChange={(event) => {
                          setValue('alimtalkSettings.waitlistTemplate', event.target.value);
                          setValue('alimtalkSettings.waitlistTemplateCode', event.target.value);
                        }}
                      />
                    </Field>
                    <TemplatePreview template={selectedWaitlistTemplate} />
                  </div>

                  <div className="space-y-3 rounded-2xl border border-gray-200 p-5">
                    <div className="flex items-center gap-2 text-gray-900">
                      <RefreshCw className="h-4 w-4 text-blue-600" />
                      <p className="font-semibold">승급 템플릿</p>
                    </div>
                    <Field label="템플릿 선택">
                      <select
                        value={watchedPromoteTemplate}
                        onChange={(event) => applyTemplate('promote', event.target.value)}
                        className={selectClassName}
                      >
                        <option value="">템플릿을 선택해 주세요</option>
                        {templateOptions.map((item) => (
                          <option key={`promote-${item.templateCode}`} value={item.templateCode}>
                            {item.templateName} ({item.templateCode})
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="템플릿 코드 직접 입력">
                      <input {...register('alimtalkSettings.promoteTemplate')} type="text" className={inputClassName} />
                    </Field>
                    <TemplatePreview template={selectedPromoteTemplate} />
                  </div>
                </div>
              </section>

              <div className="flex justify-end">
                <button
                  type="submit"
                  className="flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-blue-700"
                >
                  <Save className="h-5 w-5" />
                  설정 저장
                </button>
              </div>
            </form>
          </div>
        )}

        {activeTab === 'reservations' && (
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center text-lg font-semibold text-gray-900">
                <Clock className="mr-2 h-5 w-5 text-blue-600" />
                실시간 예약 현황
              </h2>
              <button
                onClick={() => void loadReservations()}
                className="flex items-center gap-2 rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium transition-colors hover:bg-gray-200"
              >
                <RefreshCw className="h-4 w-4" />
                새로고침
              </button>
            </div>

            {loadingReservations ? (
              <div className="py-8 text-center text-gray-500">
                <RefreshCw className="mx-auto mb-2 h-8 w-8 animate-spin text-blue-600" />
                예약 현황을 불러오는 중입니다.
              </div>
            ) : reservations.length === 0 ? (
              <div className="py-8 text-center text-gray-500">
                <AlertTriangle className="mx-auto mb-2 h-10 w-10 text-gray-400" />
                현재 예약 세션이 없습니다.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      {['상태', '사용자 ID', '생성 시간', '만료 시간', '남은 시간'].map((label) => (
                        <th key={label} className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {reservations.map((reservation) => {
                      const timeLeft = Math.max(0, reservation.expiresAt - Date.now());
                      const minutesLeft = Math.floor(timeLeft / 60000);

                      return (
                        <tr key={reservation.id} className="hover:bg-gray-50">
                          <td className="whitespace-nowrap px-6 py-4">
                              <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${getReservationStatusColor(reservation.status)}`}>
                                {reservation.status === 'reserved' && '작성 중'}
                                {reservation.status === 'processing' && '제출 처리 중'}
                                {reservation.status === 'confirmed' && '확정'}
                                {reservation.status === 'expired' && '만료'}
                              </span>
                          </td>
                          <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900">{reservation.userId}</td>
                          <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">{formatTime(reservation.createdAt)}</td>
                          <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">{formatTime(reservation.expiresAt)}</td>
                          <td className="whitespace-nowrap px-6 py-4 text-sm">
                            {reservation.status === 'reserved' ? (
                              <span
                                className={`font-semibold ${
                                  minutesLeft <= 1 ? 'text-rose-600' : minutesLeft <= 3 ? 'text-amber-600' : 'text-emerald-600'
                                }`}
                              >
                                {minutesLeft}분 남음
                              </span>
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </td>
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
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <h2 className="mb-4 flex items-center text-lg font-semibold text-gray-900">
              <Users className="mr-2 h-5 w-5 text-blue-600" />
              등록 현황
            </h2>
            <RegistrationList schoolId={schoolId!} />
          </div>
        )}
      </div>
    </div>
  );
}

