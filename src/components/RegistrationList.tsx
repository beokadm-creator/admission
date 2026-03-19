import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { Users } from 'lucide-react';
import { format } from 'date-fns';
import { db } from '../firebase/config';
import { Registration } from '../types/models';

export default function RegistrationList({ schoolId }: { schoolId: string }) {
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(true);

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

  const downloadCSV = () => {
    const headers = ['순번', '이름', '전화번호', '이메일', '학교명', '학년', '학번', '주소', '상태', '신청시간'];
    const rows = registrations.map((registration) => [
      registration.rank || '-',
      registration.studentName,
      registration.phone,
      registration.email || '-',
      registration.schoolName || '-',
      registration.grade || '-',
      registration.studentId || '-',
      registration.address || '-',
      registration.status === 'confirmed' ? '확정' : registration.status === 'waitlisted' ? '예비접수' : '취소',
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
          <button
            onClick={downloadCSV}
            className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-blue-600 transition-colors hover:bg-blue-50"
          >
            CSV 다운로드
          </button>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <SummaryBox label="확정 인원" value={confirmedCount} />
          <SummaryBox label="예비 접수 인원" value={waitlistedCount} />
          <SummaryBox label="총 신청자" value={registrations.length} />
        </div>
      </div>

      <div className="overflow-x-auto p-6">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead>
            <tr className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
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
                <tr key={registration.id} className="hover:bg-gray-50">
                  <td className="px-3 py-3 font-semibold text-gray-900">{registration.rank || '-'}</td>
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
                          ? '예비접수'
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
