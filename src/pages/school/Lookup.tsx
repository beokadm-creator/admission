import React, { useState } from 'react';
import { collection, query, where, getDocs, doc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useSchool } from '../../contexts/SchoolContext';
import { Registration } from '../../types/models';
import { format } from 'date-fns';

export default function LookupPage() {
  const { schoolConfig } = useSchool();
  const [name, setName] = useState('');
  const [phoneLast4, setPhoneLast4] = useState('');
  const [result, setResult] = useState<Registration | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!schoolConfig) return;
    
    setLoading(true);
    setError('');
    setResult(null);

    try {
      const q = query(
        collection(db, `schools/${schoolConfig.id}/registrations`),
        where('studentName', '==', name),
        where('phoneLast4', '==', phoneLast4)
      );
      
      const querySnapshot = await getDocs(q);
      if (querySnapshot.empty) {
        setError('일치하는 신청 내역이 없습니다.');
      } else {
        const data = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Registration));
        data.sort((a, b) => b.submittedAt - a.submittedAt);
        setResult(data[0]);
      }
    } catch (err) {
      console.error(err);
      setError('조회 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!result || !schoolConfig) return;
    if (!window.confirm('정말로 예약을 취소하시겠습니까? 취소 후에는 되돌릴 수 없습니다.')) return;

    try {
      await updateDoc(doc(db, `schools/${schoolConfig.id}/registrations`, result.id), {
        status: 'canceled',
        updatedAt: Date.now(),
        cancellationReason: 'user_requested'
      });
      setResult(prev => prev ? { ...prev, status: 'canceled' } : null);
      alert('예약이 취소되었습니다.');
    } catch (err) {
      console.error(err);
      alert('취소 처리 중 오류가 발생했습니다.');
    }
  };

  return (
    <div className="max-w-md mx-auto p-8">
      <h1 className="text-2xl font-bold mb-6 text-center">예약 조회</h1>
      
      <form onSubmit={handleLookup} className="space-y-4 mb-8">
        <div>
          <label className="block text-sm font-medium text-gray-700">이름</label>
          <input 
            type="text" 
            value={name}
            onChange={e => setName(e.target.value)}
            className="mt-1 block w-full border rounded p-2"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">전화번호 뒤 4자리</label>
          <input 
            type="text" 
            value={phoneLast4}
            onChange={e => setPhoneLast4(e.target.value)}
            className="mt-1 block w-full border rounded p-2"
            placeholder="5678"
            maxLength={4}
            pattern="\d{4}"
            required
          />
          <p className="text-xs text-gray-500 mt-1">예: 010-1234-5678에서 5678만 입력</p>
        </div>
        <button 
          type="submit" 
          disabled={loading}
          className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? '조회 중...' : '내역 조회'}
        </button>
      </form>

      {error && <div className="text-red-600 text-center mb-4">{error}</div>}

      {result && (
        <div className="bg-white p-6 rounded shadow border">
          <h2 className="text-lg font-bold mb-4 border-b pb-2">조회 결과</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">상태</dt>
              <dd className={`font-bold ${
                result.status === 'confirmed' ? 'text-green-600' :
                result.status === 'waitlisted' ? 'text-yellow-600' : 'text-red-600'
              }`}>
                {result.status === 'confirmed' ? '확정' :
                 result.status === 'waitlisted' ? '대기' : '취소됨'}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">신청일시</dt>
              <dd>{format(result.submittedAt, 'yyyy-MM-dd HH:mm:ss')}</dd>
            </div>
             {result.status === 'waitlisted' && (
               <div className="flex justify-between">
                 <dt className="text-gray-500">대기 순번</dt>
                 <dd>{result.rank}번</dd>
               </div>
             )}
          </dl>

          {(result.status === 'confirmed' || result.status === 'waitlisted') && (
            <button 
              onClick={handleCancel}
              className="mt-6 w-full border border-red-300 text-red-600 py-2 rounded hover:bg-red-50"
            >
              예약 취소
            </button>
          )}
        </div>
      )}
    </div>
  );
}
