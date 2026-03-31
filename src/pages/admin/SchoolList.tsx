import React, { useEffect, useState } from 'react';
import { collection, getDocs, doc, setDoc, deleteDoc, getDoc } from 'firebase/firestore';
import { Link, useNavigate } from 'react-router-dom';
import { db } from '../../firebase/config';
import { useAuth } from '../../contexts/AuthContext';
import { SchoolConfig } from '../../types/models';
import { Plus, Settings, Trash2, Activity, Users, Clock } from 'lucide-react';

interface SchoolWithStats extends SchoolConfig {
  id: string;
  slotStats?: {
    total: number;
    reserved: number;
    confirmed: number;
    available: number;
  };
}

export default function SchoolList() {
  const { adminProfile, signOut } = useAuth();
  const [schools, setSchools] = useState<SchoolWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    // Skip if adminProfile is not loaded yet
    if (!adminProfile) {
      return;
    }

    // Check for MASTER role
    if (adminProfile.role !== 'MASTER') {
      navigate('/admin');
      return;
    }

    const fetchSchools = async () => {
      try {
        console.log('Fetching schools...');
        const querySnapshot = await getDocs(collection(db, 'schools'));
        const schoolList = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as SchoolWithStats));
        console.log('Found schools:', schoolList.length);

        // Fetch slot stats from Firestore for each school
        const schoolsWithStats = await Promise.all(
          schoolList.map(async (school) => {
            try {
              const slotDocRef = doc(db, 'schools', school.id, 'queueState', 'current');
              const slotDocSnap = await getDoc(slotDocRef);
              const slotData = slotDocSnap.exists() ? slotDocSnap.data() : null;
              const slotStats = slotData
                ? {
                    total: slotData.totalCapacity || 0,
                    reserved: slotData.activeReservationCount || 0,
                    confirmed: (slotData.confirmedCount || 0) + (slotData.waitlistedCount || 0),
                    available: slotData.availableCapacity ?? 0
                  }
                : null;
              console.log('School stats:', school.id, slotStats);
              return { ...school, slotStats };
            } catch (error) {
              console.warn('Error fetching stats for school:', school.id, error);
              return { ...school, slotStats: null };
            }
          })
        );

        setSchools(schoolsWithStats);
        setLoading(false);
      } catch (error) {
        console.error('Error fetching schools:', error);
        setLoading(false);
      }
    };

    fetchSchools();
  }, [adminProfile, navigate]);

  const handleCreateSchool = async () => {
    const schoolId = prompt('새로운 학교 ID를 입력하세요 (영문, 숫자, 하이픈만 가능)');
    if (!schoolId) return;

    if (!/^[a-z0-9-]+$/.test(schoolId)) {
      alert('학교 ID는 영문 소문자, 숫자, 하이픈(-)만 사용할 수 있습니다.');
      return;
    }

    try {
      const newSchool: Partial<SchoolConfig> = {
        id: schoolId,
        name: '새 대학교',
        isActive: false,
        createdAt: Date.now(),
        maxCapacity: 100,
        waitlistCapacity: 50,
        queueSettings: {
          enabled: true,
          batchSize: 1,
          batchInterval: 10000,
          maxActiveSessions: 60
        },
        formFields: {
          collectEmail: false,
          collectAddress: false,
          collectSchoolName: false,
          collectGrade: false,
          collectStudentId: true,
        },
        buttonSettings: {
          showLookupButton: true,
          showCancelButton: true
        },
        alimtalkSettings: {
          nhnAppKey: '',
          nhnSecretKey: '',
          successTemplate: '',
          waitlistTemplate: '',
          confirmTemplateCode: '',
          waitlistTemplateCode: ''
        },
        terms: {
          privacy: { title: '개인정보 수집 및 이용 동의', content: '' },
          thirdParty: { title: '개인정보 제3자 제공 동의', content: '' },
          sms: { title: '수신 동의', content: '' }
        }
      };

      await setDoc(doc(db, 'schools', schoolId), newSchool);
      await setDoc(doc(db, 'schools', schoolId, 'queueState', 'current'), {
        currentNumber: 0,
        lastAssignedNumber: 0,
        lastAdvancedAt: 0,
        activeReservationCount: 0,
        pendingAdmissionCount: 0,
        confirmedCount: 0,
        waitlistedCount: 0,
        totalCapacity: 150,
        availableCapacity: 150,
        maxActiveSessions: 60,
        updatedAt: Date.now(),
        queueEnabled: true
      });

      navigate(`/admin/schools/${schoolId}`);
    } catch (error) {
      console.error('Error creating school:', error);
      alert('학교 생성 중 오류가 발생했습니다.');
    }
  };

  const handleDeleteSchool = async (schoolId: string, schoolName: string) => {
    if (!confirm(`정말 "${schoolName}" 학교를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) {
      return;
    }

    try {
      await deleteDoc(doc(db, 'schools', schoolId));

      setSchools(schools.filter(s => s.id !== schoolId));
      alert('학교가 삭제되었습니다.');
    } catch (error) {
      console.error('Error deleting school:', error);
      alert('삭제 중 오류가 발생했습니다.');
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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">로딩 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      {/* Header */}
      <div className="bg-white border-b shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">학교별 현황</h1>
              <p className="text-sm text-gray-500 mt-1">각 학교별 슬롯 현황 및 관리</p>
            </div>
            <div className="flex space-x-3">
              <button
                onClick={handleCreateSchool}
                className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                <Plus className="w-5 h-5" />
                <span>새 학교 추가</span>
              </button>
              <button
                onClick={handleLogout}
                className="flex items-center space-x-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors"
              >
                <span>로그아웃</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Overall Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">전체 학교</p>
                <p className="text-3xl font-bold text-gray-900 mt-2">{schools.length}</p>
              </div>
              <Settings className="w-8 h-8 text-blue-600" />
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">전체 정원</p>
                <p className="text-3xl font-bold text-gray-900 mt-2">
                  {schools.reduce((sum, s) => sum + (s.maxCapacity || 0), 0)}
                </p>
              </div>
              <Users className="w-8 h-8 text-green-600" />
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">확정 완료</p>
                <p className="text-3xl font-bold text-gray-900 mt-2">
                  {schools.reduce((sum, s) => sum + (s.slotStats?.confirmed || 0), 0)}
                </p>
              </div>
              <Activity className="w-8 h-8 text-purple-600" />
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">예약 중</p>
                <p className="text-3xl font-bold text-gray-900 mt-2">
                  {schools.reduce((sum, s) => sum + (s.slotStats?.reserved || 0), 0)}
                </p>
              </div>
              <Clock className="w-8 h-8 text-yellow-600" />
            </div>
          </div>
        </div>

        {/* School Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {schools.map((school) => {
            const slotStats = school.slotStats;
            const progressPercent = slotStats ? ((slotStats.confirmed + slotStats.reserved) / slotStats.total) * 100 : 0;

            return (
              <div
                key={school.id}
                className="bg-white rounded-lg shadow hover:shadow-lg transition-shadow overflow-hidden"
              >
                {/* Card Header */}
                <div className="p-6 border-b border-gray-200">
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold text-gray-900">{school.name}</h3>
                      <p className="text-sm text-gray-500">ID: {school.id}</p>
                    </div>
                    <span className={`px-2 py-1 rounded text-xs ${
                      school.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                    }`}>
                      {school.isActive ? '활성' : '비활성'}
                    </span>
                  </div>

                  {/* Progress Bar */}
                  {slotStats && (
                    <div className="mb-4">
                      <div className="flex justify-between text-xs text-gray-600 mb-1">
                        <span>진행률</span>
                        <span>{Math.round(progressPercent)}%</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-gradient-to-r from-blue-500 to-purple-500 h-full rounded-full transition-all duration-500"
                          style={{ width: `${progressPercent}%` }}
                        ></div>
                      </div>
                    </div>
                  )}

                  {/* Stats Grid */}
                  {slotStats && (
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="bg-blue-50 rounded p-2 text-center">
                        <p className="text-blue-600 font-semibold">{slotStats.total}</p>
                        <p className="text-blue-800 text-xs">전체</p>
                      </div>
                      <div className="bg-green-50 rounded p-2 text-center">
                        <p className="text-green-600 font-semibold">{slotStats.confirmed}</p>
                        <p className="text-green-800 text-xs">확정</p>
                      </div>
                      <div className="bg-yellow-50 rounded p-2 text-center">
                        <p className="text-yellow-600 font-semibold">{slotStats.reserved}</p>
                        <p className="text-yellow-800 text-xs">예약중</p>
                      </div>
                      <div className="bg-purple-50 rounded p-2 text-center">
                        <p className="text-purple-600 font-semibold">{slotStats.available}</p>
                        <p className="text-purple-800 text-xs">남은슬롯</p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Card Footer */}
                <div className="bg-gray-50 px-6 py-4 flex justify-between items-center">
                  <Link
                    to={`/admin/schools/${school.id}`}
                    className="flex items-center space-x-2 text-blue-600 hover:text-blue-800 font-medium text-sm transition-colors"
                  >
                    <Settings className="w-4 h-4" />
                    <span>관리</span>
                  </Link>
                  <button
                    onClick={() => handleDeleteSchool(school.id, school.name)}
                    className="flex items-center space-x-2 text-red-600 hover:text-red-800 font-medium text-sm transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>삭제</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {schools.length === 0 && (
          <div className="text-center py-12">
            <Settings className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">학교가 없습니다</h3>
            <p className="text-gray-600 mb-4">새로운 학교를 추가하여 시작하세요.</p>
            <button
              onClick={handleCreateSchool}
              className="inline-flex items-center space-x-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-colors"
            >
              <Plus className="w-5 h-5" />
              <span>첫 학교 추가</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
