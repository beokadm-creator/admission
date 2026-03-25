import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query, doc, deleteDoc, writeBatch } from 'firebase/firestore';
import { Users, Trash2, CheckSquare, Square } from 'lucide-react';
import { format } from 'date-fns';
import { db } from '../firebase/config';
import { Registration } from '../types/models';

export default function RegistrationList({ schoolId }: { schoolId: string }) {
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const confirmedCount = registrations.filter((item) => item.status === 'confirmed').length;
  const waitlistedCount = registrations.filter((item) => item.status === 'waitlisted').length;

  useEffect(() => {
    const registrationQuery = query(
      collection(db, `schools/${schoolId}/registrations`),
      orderBy('submittedAt', 'desc')
    );

    const unsubscribe = onSnapshot(registrationQuery, (snapshot) => {
      const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Registration));
      setRegistrations(data);
      setLoading(false);
    });

    return unsubscribe;
  }, [schoolId]);

  const formatRank = (registration: Registration) => {
    if (!registration.rank) return '-';
    if (registration.status === 'confirmed') return `확정${registration.rank}`;
    if (registration.status === 'waitlisted') return `대기${registration.rank}`;
    if (registration.status === 'canceled') return `취소${registration.rank}`;
    return registration.rank.toString();
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === registrations.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(registrations.map((r) => r.id)));
    }
  };

  const toggleSelect = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`선택한 ${selectedIds.size}명의 신청 내역을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없으며, 통계 및 대기열 슬롯이 자동으로 조정됩니다.`)) return;

    setDeleting(true);
    try {
      const batch = writeBatch(db);
      selectedIds.forEach((id) => {
        batch.delete(doc(db, `schools/${schoolId}/registrations`, id));
      });
      await batch.commit();
      setSelectedIds(new Set());
      alert('선택한 내역이 삭제되었습니다.');
    } catch (error) {
      console.error('Delete error:', error);
      alert('삭제 중 오류가 발생했습니다.');
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteAll = async () => {
    if (registrations.length === 0) return;
    if (!window.confirm('전체 신청 내역을 삭제하시겠습니까?\n모든 데이터가 사라지며 복구할 수 없습니다. 계속하시겠습니까?')) return;
    
    // 추가 2차 확인
    const confirmText = prompt('삭제를 최종 확인하기 위해 "전체삭제"라고 입력해주세요.');
    if (confirmText !== '전체삭제') {
      alert('확인 문구가 일치하지 않아 취소되었습니다.');
      return;
    }

    setDeleting(true);
    try {
      // 대량 삭제는 배치를 쪼개서 해야 할 수도 있으나, 여기서는 일단 배치로 처리
      // Firestore 배치 제한은 500개임.
      const registrationIds = registrations.map(r => r.id);
      const chunks = [];
      for (let i = 0; i < registrationIds.length; i += 500) {
        chunks.push(registrationIds.slice(i, i + 500));
      }

      for (const chunk of chunks) {
        const batch = writeBatch(db);
        chunk.forEach((id) => {
          batch.delete(doc(db, `schools/${schoolId}/registrations`, id));
        });
        await batch.commit();
      }
      
      setSelectedIds(new Set());
      alert('전체 내역이 삭제되었습니다.');
    } catch (error) {
      console.error('Delete all error:', error);
      alert('삭제 중 오류가 발생했습니다.');
    } finally {
      setDeleting(false);
    }
  };

  const downloadCSV = () => {
    const headers = ['순번', '이름', '전화번호', '이메일', '학교명', '학년', '학번', '주소', '상태', '신청시간'];
    const rows = registrations.map((registration) => [
      formatRank(registration),
      registration.studentName,
      registration.phone,
      registration.email || '-',
      registration.schoolName || '-',
      registration.grade || '-',
      registration.studentId || '-',
      registration.address || '-',
      registration.status === 'confirmed' ? '확정' : registration.status === 'waitlisted' ? '대기' : '취소',
      format(new Date(registration.submittedAt), 'yyyy-MM-dd HH:mm:ss')
    ]);

    const csvContent = [headers.join(','), ...rows.map((row) => row.map((field) => `"${field}"`).join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `registrations_${schoolId}_${format(new Date(), 'yyyyMMdd_HHmmss')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return <div className="py-8 text-center text-sm text-gray-500">등록 현황을 불러오는 중입니다.</div>;
  }

  return (
    <div className="mt-2 overflow-hidden rounded-2xl border border-gray-200 bg-white">
      <div className="bg-gradient-to-r from-blue-600 to-sky-500 p-6 text-white">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <h3 className="flex items-center text-xl font-bold">
            <Users className="mr-2 h-6 w-6" />
            신청자 관리
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleDeleteAll}
              disabled={deleting || registrations.length === 0}
              className="flex items-center gap-1 rounded-xl bg-rose-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-rose-600 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              전체 삭제
            </button>
            <button
              onClick={handleDeleteSelected}
              disabled={deleting || selectedIds.size === 0}
              className="flex items-center gap-1 rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              선택 삭제 ({selectedIds.size})
            </button>
            <button
              onClick={downloadCSV}
              className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-blue-600 transition-colors hover:bg-blue-50"
            >
              CSV 다운로드
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <SummaryBox label="확정 인원" value={confirmedCount} />
          <SummaryBox label="대기 인원" value={waitlistedCount} />
          <SummaryBox label="총 신청자" value={registrations.length} />
        </div>
      </div>

      <div className="overflow-x-auto p-6">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead>
            <tr className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
              <th className="px-3 py-3 w-10">
                <button 
                  onClick={toggleSelectAll}
                  className="text-gray-400 hover:text-blue-600 transition-colors"
                >
                  {selectedIds.size > 0 && selectedIds.size === registrations.length ? (
                    <CheckSquare className="h-5 w-5 text-blue-600" />
                  ) : (
                    <Square className="h-5 w-5" />
                  )}
                </button>
              </th>
              {['순번', '이름', '전화번호', '이메일', '학교명', '학년', '학번', '주소', '상태', '신청시간'].map((label) => (
                <th key={label} className="px-3 py-3">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {registrations.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-gray-500">
                  아직 등록된 신청자가 없습니다.
                </td>
              </tr>
            ) : (
              registrations.map((registration) => (
                <tr key={registration.id} className={`hover:bg-gray-50 transition-colors ${selectedIds.has(registration.id) ? 'bg-blue-50/50' : ''}`}>
                  <td className="px-3 py-3">
                    <button 
                      onClick={() => toggleSelect(registration.id)}
                      className="text-gray-400 hover:text-blue-600 transition-colors"
                    >
                      {selectedIds.has(registration.id) ? (
                        <CheckSquare className="h-5 w-5 text-blue-600" />
                      ) : (
                        <Square className="h-5 w-5" />
                      )}
                    </button>
                  </td>
                  <td className="px-3 py-3 font-semibold text-gray-900">{formatRank(registration)}</td>
                  <td className="px-3 py-3 text-gray-900">{registration.studentName}</td>
                  <td className="px-3 py-3">{registration.phone}</td>
                  <td className="px-3 py-3">{registration.email || '-'}</td>
                  <td className="px-3 py-3">{registration.schoolName || '-'}</td>
                  <td className="px-3 py-3 text-center">{registration.grade || '-'}</td>
                  <td className="px-3 py-3 text-center">{registration.studentId || '-'}</td>
                  <td className="px-3 py-3">{registration.address || '-'}</td>
                  <td className="px-3 py-3">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                        registration.status === 'confirmed'
                          ? 'bg-emerald-100 text-emerald-800'
                          : registration.status === 'waitlisted'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-rose-100 text-rose-800'
                      }`}
                    >
                      {registration.status === 'confirmed'
                        ? '확정'
                        : registration.status === 'waitlisted'
                          ? '대기'
                          : '취소'}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-gray-500">{format(new Date(registration.submittedAt), 'yyyy-MM-dd HH:mm:ss')}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SummaryBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-white/15 p-4 text-center backdrop-blur-sm">
      <div className="text-3xl font-black">{value.toLocaleString()}</div>
      <div className="mt-1 text-sm text-blue-50">{label}</div>
    </div>
  );
}
