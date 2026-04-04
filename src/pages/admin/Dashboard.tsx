import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../firebase/config';
import { Settings, Users, Activity, TrendingUp, School } from 'lucide-react';

interface SchoolBase {
  id: string;
  name: string;
  maxCapacity: number;
  isActive: boolean;
}

interface SchoolStats extends SchoolBase {
  confirmedCount: number;
  waitlistedCount: number;
}

export default function AdminDashboard() {
  const { adminProfile, loading } = useAuth();
  const navigate = useNavigate();
  const [schools, setSchools] = useState<SchoolStats[]>([]);
  const [loadingStats, setLoadingStats] = useState(true);

  // schoolId → { confirmedCount, waitlistedCount } 실시간 통계
  const [queueStats, setQueueStats] = useState<Record<string, { confirmedCount: number; waitlistedCount: number }>>({});
  const queueUnsubscribesRef = useRef<Record<string, () => void>>({});

  useEffect(() => {
    if (loading || !adminProfile) return;

    if (adminProfile.role === 'SCHOOL' && adminProfile.assignedSchoolId) {
      navigate(`/admin/schools/${adminProfile.assignedSchoolId}`);
      return;
    }

    if (adminProfile.role !== 'MASTER') return;

    const schoolsRef = collection(db, 'schools');
    const unsubscribe = onSnapshot(schoolsRef, (snapshot) => {
      const schoolsData: SchoolBase[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          name: data.name || '알 수 없는 학교',
          maxCapacity: Number(data.maxCapacity || 0),
          isActive: data.isActive !== false
        };
      });

      setSchools(
        schoolsData.map((s) => ({
          ...s,
          confirmedCount: queueStats[s.id]?.confirmedCount ?? 0,
          waitlistedCount: queueStats[s.id]?.waitlistedCount ?? 0
        }))
      );
      setLoadingStats(false);

      // 새로 추가된 학교의 queueState 구독
      const currentIds = new Set(schoolsData.map((s) => s.id));

      // 삭제된 학교 구독 해제
      Object.keys(queueUnsubscribesRef.current).forEach((id) => {
        if (!currentIds.has(id)) {
          queueUnsubscribesRef.current[id]?.();
          delete queueUnsubscribesRef.current[id];
        }
      });

      // 신규 학교 구독 등록
      schoolsData.forEach((school) => {
        if (queueUnsubscribesRef.current[school.id]) return;
        const stateRef = doc(db, 'schools', school.id, 'queueState', 'round1');
        queueUnsubscribesRef.current[school.id] = onSnapshot(stateRef, (snap) => {
          const data = snap.data();
          setQueueStats((prev) => ({
            ...prev,
            [school.id]: {
              confirmedCount: Number(data?.confirmedCount ?? 0),
              waitlistedCount: Number(data?.waitlistedCount ?? 0)
            }
          }));
        });
      });
    }, (error) => {
      console.error('Error listening to school stats:', error);
      setLoadingStats(false);
    });

    return () => {
      unsubscribe();
      Object.values(queueUnsubscribesRef.current).forEach((fn) => fn());
      queueUnsubscribesRef.current = {};
    };
  }, [adminProfile, loading, navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  // queueStats가 바뀔 때마다 schools에 반영
  useEffect(() => {
    setSchools((prev) =>
      prev.map((s) => ({
        ...s,
        confirmedCount: queueStats[s.id]?.confirmedCount ?? s.confirmedCount,
        waitlistedCount: queueStats[s.id]?.waitlistedCount ?? s.waitlistedCount
      }))
    );
  }, [queueStats]);

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
                          <span>{school.maxCapacity > 0 ? Math.round((school.confirmedCount / school.maxCapacity) * 100) : 0}%</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-gradient-to-r from-blue-500 to-purple-500 h-full rounded-full transition-all duration-500"
                            style={{ width: `${school.maxCapacity > 0 ? Math.min((school.confirmedCount / school.maxCapacity) * 100, 100) : 0}%` }}
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
