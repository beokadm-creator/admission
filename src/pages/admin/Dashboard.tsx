import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs } from 'firebase/firestore';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../firebase/config';
import { Settings, Users, Activity, TrendingUp, School } from 'lucide-react';

interface SchoolStats {
  id: string;
  name: string;
  confirmedCount: number;
  waitlistedCount: number;
  maxCapacity: number;
  isActive: boolean;
}

export default function AdminDashboard() {
  const { adminProfile, loading } = useAuth();
  const navigate = useNavigate();
  const [schools, setSchools] = useState<SchoolStats[]>([]);
  const [loadingStats, setLoadingStats] = useState(true);

  useEffect(() => {
    if (!loading && adminProfile) {
      if (adminProfile.role === 'SCHOOL' && adminProfile.assignedSchoolId) {
        navigate(`/admin/schools/${adminProfile.assignedSchoolId}`);
        return;
      }
    }

    const fetchSchoolStats = async () => {
      try {
        const schoolsSnapshot = await getDocs(collection(db, 'schools'));
        const schoolsData = await Promise.all(
          schoolsSnapshot.docs.map(async (schoolDoc) => {
            const schoolData = schoolDoc.data();
            const registrationsSnapshot = await getDocs(
              collection(db, `schools/${schoolDoc.id}/registrations`)
            );

            const confirmedCount = registrationsSnapshot.docs.filter(
              doc => doc.data().status === 'confirmed'
            ).length;
            const waitlistedCount = registrationsSnapshot.docs.filter(
              doc => doc.data().status === 'waitlisted'
            ).length;

            return {
              id: schoolDoc.id,
              name: schoolData.name,
              confirmedCount,
              waitlistedCount,
              maxCapacity: schoolData.maxCapacity || 0,
              isActive: schoolData.isActive || false
            } as SchoolStats;
          })
        );

        setSchools(schoolsData);
      } catch (error) {
        console.error('Error fetching school stats:', error);
      } finally {
        setLoadingStats(false);
      }
    };

    if (adminProfile?.role === 'MASTER') {
      fetchSchoolStats();
    }
  }, [adminProfile, loading, navigate]);

  if (loading || loadingStats) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">로딩 중...</p>
        </div>
      </div>
    );
  }

  const totalConfirmed = schools.reduce((sum, s) => sum + s.confirmedCount, 0);
  const totalWaitlisted = schools.reduce((sum, s) => sum + s.waitlistedCount, 0);
  const activeSchools = schools.filter(s => s.isActive).length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      {/* Header */}
      <div className="bg-white border-b shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">대시보드</h1>
              <p className="text-sm text-gray-500 mt-1">슬롯 예약 시스템 현황</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-gray-500">환영합니다</p>
              <p className="text-lg font-semibold text-gray-900">{adminProfile?.name}님</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Overall Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">전체 학교</p>
                <p className="text-3xl font-bold text-gray-900 mt-2">{schools.length}</p>
                <p className="text-xs text-gray-400 mt-1">개교</p>
              </div>
              <School className="w-8 h-8 text-blue-600" />
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">활성화 학교</p>
                <p className="text-3xl font-bold text-gray-900 mt-2">{activeSchools}</p>
                <p className="text-xs text-gray-400 mt-1">개교 운영 중</p>
              </div>
              <Activity className="w-8 h-8 text-green-600" />
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">전체 확정</p>
                <p className="text-3xl font-bold text-gray-900 mt-2">{totalConfirmed}</p>
                <p className="text-xs text-gray-400 mt-1">명</p>
              </div>
              <Users className="w-8 h-8 text-purple-600" />
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">전체 대기</p>
                <p className="text-3xl font-bold text-gray-900 mt-2">{totalWaitlisted}</p>
                <p className="text-xs text-gray-400 mt-1">명</p>
              </div>
              <TrendingUp className="w-8 h-8 text-yellow-600" />
            </div>
          </div>
        </div>

        {/* School Stats Grid */}
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">학교별 현황</h2>
          </div>
          <div className="p-6">
            {schools.length === 0 ? (
              <div className="text-center py-12">
                <School className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">등록된 학교가 없습니다</h3>
                <p className="text-gray-600 mb-4">새로운 학교를 추가하여 시작하세요.</p>
                <button
                  onClick={() => navigate('/admin/schools')}
                  className="inline-flex items-center space-x-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-colors"
                >
                  <Settings className="w-5 h-5" />
                  <span>학교 관리로 이동</span>
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {schools.map((school) => (
                  <div
                    key={school.id}
                    className="border rounded-lg hover:shadow-md transition-shadow cursor-pointer"
                    onClick={() => navigate(`/admin/schools/${school.id}`)}
                  >
                    <div className="p-6">
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

                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div className="bg-green-50 rounded p-3 text-center">
                          <p className="text-green-600 font-semibold">{school.confirmedCount}</p>
                          <p className="text-green-800 text-xs">확정</p>
                        </div>
                        <div className="bg-yellow-50 rounded p-3 text-center">
                          <p className="text-yellow-600 font-semibold">{school.waitlistedCount}</p>
                          <p className="text-yellow-800 text-xs">대기</p>
                        </div>
                      </div>

                      <div className="mt-4">
                        <div className="flex justify-between text-xs text-gray-600 mb-1">
                          <span>진행률</span>
                          <span>{Math.round((school.confirmedCount / school.maxCapacity) * 100)}%</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-gradient-to-r from-blue-500 to-purple-500 h-full rounded-full transition-all duration-500"
                            style={{ width: `${Math.min((school.confirmedCount / school.maxCapacity) * 100, 100)}%` }}
                          ></div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
          <button
            onClick={() => navigate('/admin/schools')}
            className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow text-left"
          >
            <div className="flex items-center space-x-4">
              <div className="bg-blue-100 rounded-lg p-3">
                <Settings className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">학교 관리</h3>
                <p className="text-sm text-gray-500">학교 설정 및 시스템 관리</p>
              </div>
            </div>
          </button>

          <button
            onClick={() => navigate('/admin/schools')}
            className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow text-left"
          >
            <div className="flex items-center space-x-4">
              <div className="bg-green-100 rounded-lg p-3">
                <Activity className="w-6 h-6 text-green-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">등록 현황</h3>
                <p className="text-sm text-gray-500">각 학교별 신청자 현황 확인</p>
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
