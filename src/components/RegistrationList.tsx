import React, { useEffect, useState } from 'react';
import { collection, query, orderBy, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { Registration } from '../types/models';
import { format } from 'date-fns';
import { Users, ChevronUp } from 'lucide-react';

export default function RegistrationList({ schoolId }: { schoolId: string }) {
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(true);
  const [promoting, setPromoting] = useState(false);

  const confirmedCount = registrations.filter(r => r.status === 'confirmed').length;
  const waitlistedCount = registrations.filter(r => r.status === 'waitlisted').length;

  useEffect(() => {
    const q = query(collection(db, `schools/${schoolId}/registrations`), orderBy('submittedAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Registration));
      setRegistrations(data);
      setLoading(false);
    });
    return unsubscribe;
  }, [schoolId]);

  const handlePromote = async (regId: string) => {
    if (window.confirm('해당 대기자를 확정 상태로 변경하시겠습니까?')) {
      try {
        await updateDoc(doc(db, `schools/${schoolId}/registrations`, regId), {
          status: 'confirmed',
          updatedAt: Date.now()
        });
        alert('승급되었습니다.');
      } catch (error) {
        console.error('Error promoting user:', error);
        alert('오류가 발생했습니다.');
      }
    }
  };

  const handleBatchPromote = async (count: number) => {
    const waitlisted = registrations
      .filter(r => r.status === 'waitlisted')
      .sort((a, b) => a.rank - b.rank)
      .slice(0, count);

    if (waitlisted.length === 0) {
      alert('대기자가 없습니다.');
      return;
    }

    if (waitlisted.length < count) {
      if (!window.confirm(`대기자가 ${waitlisted.length}명뿐입니다. ${waitlisted.length}명을 승급하시겠습니까?`)) {
        return;
      }
    } else if (!window.confirm(`대기자 ${count}명을 확정 상태로 변경하시겠습니까?`)) {
      return;
    }

    setPromoting(true);
    try {
      await Promise.all(
        waitlisted.map(reg =>
          updateDoc(doc(db, `schools/${schoolId}/registrations`, reg.id), {
            status: 'confirmed',
            updatedAt: Date.now()
          })
        )
      );
      alert(`${waitlisted.length}명을 승급했습니다.`);
    } catch (error) {
      console.error('Error batch promoting:', error);
      alert('오류가 발생했습니다.');
    } finally {
      setPromoting(false);
    }
  };

  const downloadCSV = () => {
    const headers = ['이름', '전화번호', '상태', '신청시간', '순번'];
    const rows = registrations.map(reg => [
      reg.studentName,
      reg.phone,
      reg.status,
      format(reg.submittedAt, 'yyyy-MM-dd HH:mm:ss'),
      reg.rank || '-'
    ]);
    
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `registrations_${schoolId}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loading) return <div>Loading registrations...</div>;

  return (
    <div className="mt-8">
      <div className="bg-gradient-to-r from-blue-500 to-blue-600 rounded-t-xl p-6 shadow-lg">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-bold text-white flex items-center">
            <Users className="w-6 h-6 mr-2" />
            신청자 관리
          </h3>
          <button onClick={downloadCSV} className="bg-white text-blue-600 px-4 py-2 rounded-lg font-semibold hover:bg-blue-50 transition-colors">
            CSV 다운로드
          </button>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white bg-opacity-20 rounded-lg p-4 text-center">
            <div className="text-3xl font-bold text-white">{confirmedCount}</div>
            <div className="text-sm text-blue-100">확정 인원</div>
          </div>
          <div className="bg-white bg-opacity-20 rounded-lg p-4 text-center">
            <div className="text-3xl font-bold text-white">{waitlistedCount}</div>
            <div className="text-sm text-blue-100">대기 인원</div>
          </div>
          <div className="bg-white bg-opacity-20 rounded-lg p-4 text-center">
            <div className="text-3xl font-bold text-white">{registrations.length}</div>
            <div className="text-sm text-blue-100">총 신청자</div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-b-xl p-6 shadow-lg border border-t-0 border-gray-200">
        <div className="mb-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
          <h4 className="font-semibold text-blue-900 mb-3 flex items-center">
            <ChevronUp className="w-5 h-5 mr-2" />
            대기자 일괄 승급
          </h4>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => handleBatchPromote(1)}
              disabled={promoting || waitlistedCount === 0}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
            >
              1명 승급
            </button>
            <button
              onClick={() => handleBatchPromote(5)}
              disabled={promoting || waitlistedCount < 5}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
            >
              5명 승급
            </button>
            <button
              onClick={() => handleBatchPromote(10)}
              disabled={promoting || waitlistedCount < 10}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
            >
              10명 승급
            </button>
            <button
              onClick={() => handleBatchPromote(20)}
              disabled={promoting || waitlistedCount < 20}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
            >
              20명 승급
            </button>
            <button
              onClick={() => handleBatchPromote(50)}
              disabled={promoting || waitlistedCount < 50}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
            >
              50명 승급
            </button>
            <button
              onClick={() => handleBatchPromote(waitlistedCount)}
              disabled={promoting || waitlistedCount === 0}
              className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
            >
              전체 승급 ({waitlistedCount}명)
            </button>
          </div>
          {promoting && (
            <div className="mt-3 text-sm text-blue-700">
              승급 중입니다...
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full bg-white border">
            <thead>
              <tr className="bg-gray-100">
                <th className="py-2 px-4 border text-left">이름</th>
                <th className="py-2 px-4 border text-left">전화번호</th>
                <th className="py-2 px-4 border text-center">상태</th>
                <th className="py-2 px-4 border text-center">신청시간</th>
                <th className="py-2 px-4 border text-center">관리</th>
              </tr>
            </thead>
            <tbody>
              {registrations.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-gray-500">신청자가 없습니다.</td>
                </tr>
              ) : (
                registrations.map((reg) => (
                  <tr key={reg.id} className="hover:bg-gray-50">
                    <td className="py-2 px-4 border">{reg.studentName}</td>
                    <td className="py-2 px-4 border">{reg.phone}</td>
                    <td className="py-2 px-4 border text-center">
                      <span className={`px-2 py-1 rounded text-xs font-semibold ${
                        reg.status === 'confirmed' ? 'bg-green-100 text-green-800' :
                        reg.status === 'waitlisted' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-red-100 text-red-800'
                      }`}>
                        {reg.status === 'confirmed' ? '확정' :
                         reg.status === 'waitlisted' ? '대기' : '취소'}
                      </span>
                    </td>
                    <td className="py-2 px-4 border text-center">{format(reg.submittedAt, 'yyyy-MM-dd HH:mm:ss')}</td>
                    <td className="py-2 px-4 border text-center">
                      {reg.status === 'waitlisted' && (
                        <button
                          onClick={() => handlePromote(reg.id)}
                          className="bg-blue-500 text-white px-2 py-1 rounded text-xs hover:bg-blue-600"
                        >
                          수동 승급
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}