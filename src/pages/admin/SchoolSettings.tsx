import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { doc, getDoc, setDoc, collection, getDocs, query, where } from 'firebase/firestore';
import { ref, onValue, set, get } from 'firebase/database';
import { httpsCallable, getFunctions } from 'firebase/functions';
import { db, rtdb } from '../../firebase/config';
import { useAuth } from '../../contexts/AuthContext';
import { SchoolConfig } from '../../types/models';
import RegistrationList from '../../components/RegistrationList';
import {
  Settings,
  Users,
  Save,
  LogOut,
  ArrowLeft,
  Activity,
  Clock,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  RefreshCw,
  Trash2
} from 'lucide-react';
import { format } from 'date-fns';

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
  status: 'reserved' | 'confirmed' | 'expired';
  createdAt: number;
  expiresAt: number;
  data?: any;
}

export default function SchoolSettings() {
  const { schoolId } = useParams<{ schoolId: string }>();
  const { adminProfile, signOut } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'settings' | 'reservations' | 'registrations'>('overview');

  const { register, handleSubmit, setValue, watch } = useForm<SchoolConfig>();

  // Real-time stats
  const [slotStats, setSlotStats] = useState<SlotStats | null>(null);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loadingReservations, setLoadingReservations] = useState(false);

  useEffect(() => {
    if (!schoolId) return;

    if (adminProfile?.role === 'SCHOOL' && adminProfile.assignedSchoolId !== schoolId) {
      alert('접근 권한이 없습니다.');
      navigate('/admin');
      return;
    }

    const loadSchool = async () => {
      try {
        const docRef = doc(db, 'schools', schoolId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          const data = docSnap.data() as SchoolConfig;
          (Object.keys(data) as Array<keyof SchoolConfig>).forEach(key => {
            setValue(key, data[key]);
          });
        }
      } catch (error) {
        console.error('Error loading school:', error);
      } finally {
        setLoading(false);
      }
    };

    loadSchool();
  }, [schoolId, adminProfile, navigate, setValue]);

  // Real-time slot stats
  useEffect(() => {
    if (!schoolId) return;

    const slotsRef = ref(rtdb, `slots/${schoolId}`);
    const unsubscribe = onValue(slotsRef, (snapshot) => {
      if (snapshot.exists()) {
        setSlotStats(snapshot.val() as SlotStats);
      } else {
        // Initialize if not exists
        setSlotStats({
          total: watch('maxCapacity') || 0,
          reserved: 0,
          confirmed: 0,
          available: watch('maxCapacity') || 0,
          lastUpdated: Date.now()
        });
      }
    });

    return unsubscribe;
  }, [schoolId, watch]);

  // Load reservations
  const loadReservations = async () => {
    if (!schoolId) return;

    setLoadingReservations(true);
    try {
      const reservationsRef = ref(rtdb, `reservations/${schoolId}`);
      const snapshot = await get(reservationsRef);

      if (snapshot.exists()) {
        const data = snapshot.val();
        const reservationList = Object.entries(data)
          .map(([id, reservation]: [string, any]) => ({
            ...reservation,
            id
          }))
          .sort((a, b) => b.createdAt - a.createdAt);

        setReservations(reservationList);
      }
    } catch (error) {
      console.error('Error loading reservations:', error);
    } finally {
      setLoadingReservations(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'reservations' && schoolId) {
      loadReservations();
    }
  }, [activeTab, schoolId]);

  const onSubmit = async (data: SchoolConfig) => {
    if (!schoolId) return;
    try {
      await setDoc(doc(db, 'schools', schoolId), {
        ...data,
        id: schoolId,
        updatedAt: Date.now()
      }, { merge: true });

      // Update RTDB slots if maxCapacity changed
      if (data.maxCapacity !== slotStats?.total) {
        await set(ref(rtdb, `slots/${schoolId}`), {
          total: data.maxCapacity,
          reserved: slotStats?.reserved || 0,
          confirmed: slotStats?.confirmed || 0,
          available: data.maxCapacity - (slotStats?.reserved || 0),
          lastUpdated: Date.now()
        });
      }

      alert('설정이 저장되었습니다.');
    } catch (error) {
      console.error('Error saving settings:', error);
      alert('저장 중 오류가 발생했습니다.');
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

  const formatTime = (timestamp: number) => {
    return format(new Date(timestamp), 'HH:mm:ss');
  };

  const getReservationStatusColor = (status: string) => {
    switch (status) {
      case 'reserved':
        return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'confirmed':
        return 'bg-green-100 text-green-800 border-green-300';
      case 'expired':
        return 'bg-red-100 text-red-800 border-red-300';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600">로딩 중...</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      {/* Header */}
      <div className="bg-white border-b shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => navigate('/admin/schools')}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ArrowLeft className="w-5 h-5 text-gray-600" />
              </button>
              <div>
                <h1 className="text-2xl font-bold text-gray-900 flex items-center">
                  <Settings className="w-6 h-6 mr-2 text-blue-600" />
                  {schoolId}
                </h1>
                <p className="text-sm text-gray-500 mt-1">슬롯 예약 시스템 관리</p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center space-x-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
            >
              <LogOut className="w-4 h-4" />
              <span>로그아웃</span>
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Tab Navigation */}
        <div className="bg-white rounded-lg shadow mb-6">
          <div className="border-b border-gray-200">
            <nav className="flex space-x-8 px-6" aria-label="Tabs">
              {[
                { key: 'overview', label: '현황판', icon: Activity },
                { key: 'settings', label: '설정', icon: Settings },
                { key: 'reservations', label: '예약 관리', icon: Clock },
                { key: 'registrations', label: '등록 현황', icon: Users },
              ].map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setActiveTab(key as any)}
                  className={`${
                    activeTab === key
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center transition-colors`}
                >
                  <Icon className="w-4 h-4 mr-2" />
                  {label}
                </button>
              ))}
            </nav>
          </div>
        </div>

        {/* Tab Content */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Slot Statistics */}
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                <Activity className="w-5 h-5 mr-2 text-blue-600" />
                실시간 슬롯 현황
              </h2>

              {slotStats ? (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <p className="text-sm text-blue-600 font-semibold">전체 정원</p>
                    <p className="text-3xl font-bold text-blue-900 mt-2">{slotStats.total}</p>
                    <p className="text-xs text-blue-600 mt-1">명</p>
                  </div>

                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                    <p className="text-sm text-yellow-600 font-semibold">예약 중</p>
                    <p className="text-3xl font-bold text-yellow-900 mt-2">{slotStats.reserved}</p>
                    <p className="text-xs text-yellow-600 mt-1">명 (입력 중)</p>
                  </div>

                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <p className="text-sm text-green-600 font-semibold">확정 완료</p>
                    <p className="text-3xl font-bold text-green-900 mt-2">{slotStats.confirmed}</p>
                    <p className="text-xs text-green-600 mt-1">명</p>
                  </div>

                  <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                    <p className="text-sm text-purple-600 font-semibold">남은 슬롯</p>
                    <p className="text-3xl font-bold text-purple-900 mt-2">{slotStats.available}</p>
                    <p className="text-xs text-purple-600 mt-1">명</p>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2" />
                  <p>데이터를 불러오는 중...</p>
                </div>
              )}

              {/* Progress Bar */}
              {slotStats && (
                <div className="mt-6">
                  <div className="flex justify-between text-sm text-gray-600 mb-2">
                    <span>진행률</span>
                    <span>{Math.round(((slotStats.confirmed + slotStats.reserved) / slotStats.total) * 100)}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-4 overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-blue-500 to-purple-500 h-full transition-all duration-500"
                      style={{
                        width: `${((slotStats.confirmed + slotStats.reserved) / slotStats.total) * 100}%`
                      }}
                    ></div>
                  </div>
                </div>
              )}
            </div>

            {/* Quick Actions */}
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">빠른 기능</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <button
                  onClick={() => setActiveTab('reservations')}
                  className="flex items-center justify-center space-x-2 p-4 border-2 border-yellow-200 rounded-lg hover:bg-yellow-50 transition-colors"
                >
                  <Clock className="w-5 h-5 text-yellow-600" />
                  <span className="font-semibold text-yellow-900">예약 현황 보기</span>
                </button>

                <button
                  onClick={() => setActiveTab('registrations')}
                  className="flex items-center justify-center space-x-2 p-4 border-2 border-green-200 rounded-lg hover:bg-green-50 transition-colors"
                >
                  <Users className="w-5 h-5 text-green-600" />
                  <span className="font-semibold text-green-900">등록자 명단</span>
                </button>

                <button
                  onClick={() => setActiveTab('settings')}
                  className="flex items-center justify-center space-x-2 p-4 border-2 border-blue-200 rounded-lg hover:bg-blue-50 transition-colors"
                >
                  <Settings className="w-5 h-5 text-blue-600" />
                  <span className="font-semibold text-blue-900">시스템 설정</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <Settings className="w-5 h-5 mr-2 text-blue-600" />
              슬롯 시스템 설정
            </h2>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
              {/* Capacity Settings */}
              <div className="border-b pb-6">
                <h3 className="text-md font-semibold text-gray-800 mb-4">정원 설정</h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      최대 정원
                    </label>
                    <input
                      {...register('maxCapacity', { required: true, valueAsNumber: true })}
                      type="number"
                      className="block w-full border border-gray-300 rounded-md p-2.5 focus:ring-blue-500 focus:border-blue-500"
                    />
                    <p className="text-xs text-gray-500 mt-1">전체 수용 가능 인원</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      대기열 정원
                    </label>
                    <input
                      {...register('waitlistCapacity', { required: true, valueAsNumber: true })}
                      type="number"
                      className="block w-full border border-gray-300 rounded-md p-2.5 focus:ring-blue-500 focus:border-blue-500"
                    />
                    <p className="text-xs text-gray-500 mt-1">대기자 수용 가능 인원</p>
                  </div>
                </div>
              </div>

              {/* Form Fields */}
              <div className="border-b pb-6">
                <h3 className="text-md font-semibold text-gray-800 mb-4">수집 정보 설정</h3>

                <div className="space-y-3">
                  {[
                    { key: 'collectStudentId', label: '학번' },
                    { key: 'collectEmail', label: '이메일' },
                    { key: 'collectSchoolName', label: '학교명' },
                    { key: 'collectGrade', label: '학년' },
                    { key: 'collectAddress', label: '주소' }
                  ].map(({ key, label }) => (
                    <label key={key} className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer">
                      <input
                        {...register(`formFields.${key}` as any)}
                        type="checkbox"
                        className="h-5 w-5 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                      />
                      <span className="font-medium text-gray-700">{label} 수집</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* AlimTalk Settings */}
              <div className="border-b pb-6">
                <h3 className="text-md font-semibold text-gray-800 mb-4">알림톡 설정</h3>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      NHN App Key
                    </label>
                    <input
                      {...register('alimtalkSettings.nhnAppKey')}
                      className="block w-full border border-gray-300 rounded-md p-2.5 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      NHN Secret Key
                    </label>
                    <input
                      {...register('alimtalkSettings.nhnSecretKey')}
                      className="block w-full border border-gray-300 rounded-md p-2.5 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      확정 템플릿 코드
                    </label>
                    <input
                      {...register('alimtalkSettings.confirmTemplateCode')}
                      className="block w-full border border-gray-300 rounded-md p-2.5 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="예: CONFIRM_001"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      대기 템플릿 코드
                    </label>
                    <input
                      {...register('alimtalkSettings.waitlistTemplateCode')}
                      className="block w-full border border-gray-300 rounded-md p-2.5 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="예: WAITLIST_001"
                    />
                  </div>
                </div>
              </div>

              {/* Submit Button */}
              <div className="flex justify-end">
                <button
                  type="submit"
                  className="flex items-center space-x-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-colors"
                >
                  <Save className="w-5 h-5" />
                  <span>설정 저장</span>
                </button>
              </div>
            </form>
          </div>
        )}

        {activeTab === 'reservations' && (
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                <Clock className="w-5 h-5 mr-2 text-blue-600" />
                실시간 예약 현황
              </h2>
              <button
                onClick={loadReservations}
                className="flex items-center space-x-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                <span>새로고침</span>
              </button>
            </div>

            {loadingReservations ? (
              <div className="text-center py-8">
                <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2 text-blue-600" />
                <p className="text-gray-600">데이터를 불러오는 중...</p>
              </div>
            ) : reservations.length === 0 ? (
              <div className="text-center py-8">
                <AlertTriangle className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                <p className="text-gray-600">현재 예약이 없습니다.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">상태</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">사용자 ID</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">생성 시간</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">만료 시간</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">남은 시간</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {reservations.map((reservation) => {
                      const timeLeft = Math.max(0, reservation.expiresAt - Date.now());
                      const minutesLeft = Math.floor(timeLeft / 60000);

                      return (
                        <tr key={reservation.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full border ${getReservationStatusColor(reservation.status)}`}>
                              {reservation.status === 'reserved' && '예약 중'}
                              {reservation.status === 'confirmed' && '확정'}
                              {reservation.status === 'expired' && '만료'}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {reservation.userId}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {formatTime(reservation.createdAt)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {formatTime(reservation.expiresAt)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {reservation.status === 'reserved' && (
                              <span className={`text-sm font-semibold ${
                                minutesLeft <= 1 ? 'text-red-600' :
                                minutesLeft <= 3 ? 'text-yellow-600' :
                                'text-green-600'
                              }`}>
                                {minutesLeft}분 남음
                              </span>
                            )}
                            {reservation.status !== 'reserved' && (
                              <span className="text-sm text-gray-400">-</span>
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
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <Users className="w-5 h-5 mr-2 text-blue-600" />
              등록 현황
            </h2>
            <RegistrationList schoolId={schoolId!} />
          </div>
        )}
      </div>
    </div>
  );
}
