import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ref, onValue, set } from 'firebase/database';
import { rtdb as database } from '../firebase/config';
import { Loader2, CheckCircle2, Clock, AlertTriangle, Ticket } from 'lucide-react';

interface QueueData {
  currentNumber: number;
  lastAssignedNumber: number;
}

export default function SmartQueueGate() {
  const { schoolId } = useParams<{ schoolId: string }>();
  const navigate = useNavigate();
  const [queueData, setQueueData] = useState<QueueData>({ currentNumber: 0, lastAssignedNumber: 0 });
  const [myNumber, setMyNumber] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!schoolId) return;

    const queueRef = ref(database, `queue/${schoolId}`);
    const unsubscribe = onValue(queueRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setQueueData({
          currentNumber: data.currentNumber || 0,
          lastAssignedNumber: data.lastAssignedNumber || 0
        });
      }
      setLoading(false);
    });

    return unsubscribe;
  }, [schoolId]);

  const getNumber = async () => {
    if (!schoolId) return;

    const queueRef = ref(database, `queue/${schoolId}`);
    const newNumber = queueData.lastAssignedNumber + 1;

    await set(queueRef, {
      ...queueData,
      lastAssignedNumber: newNumber
    });

    setMyNumber(newNumber);
    localStorage.setItem(`queue_${schoolId}`, newNumber.toString());
  };

  useEffect(() => {
    const savedNumber = localStorage.getItem(`queue_${schoolId}`);
    if (savedNumber) {
      setMyNumber(parseInt(savedNumber));
    }
  }, [schoolId]);

  const checkCanEnter = () => {
    if (!schoolId) return false;
    const savedNumber = localStorage.getItem(`queue_${schoolId}`);
    if (!savedNumber) return false;

    const num = parseInt(savedNumber);
    return num <= queueData.currentNumber;
  };

  const canEnter = checkCanEnter();
  const waitingAhead = myNumber ? Math.max(0, myNumber - queueData.currentNumber - 1) : 0;

  const goToRegister = () => {
    if (!schoolId) return;

    // Generate session token
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 11);
    const sessionToken = `${timestamp}_${randomStr}`;
    const expirationTime = timestamp + (20 * 60 * 1000); // 20 minutes

    // Store session token and expiration
    localStorage.setItem(`sessionToken_${schoolId}`, sessionToken);
    localStorage.setItem(`sessionTokenExpires_${schoolId}`, expirationTime.toString());

    navigate(`/${schoolId}/register`);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">대기열 정보를 불러오는 중...</p>
        </div>
      </div>
    );
  }

  // Can enter registration
  if (canEnter) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 to-emerald-100">
        <div className="bg-white p-8 rounded-2xl shadow-2xl max-w-md w-full text-center">
          <div className="mb-6">
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-10 h-10 text-green-600" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">입장 가능!</h2>
            <p className="text-gray-600">지금 바로 신청을 진행할 수 있습니다.</p>
          </div>
          <button
            onClick={goToRegister}
            className="w-full bg-gradient-to-r from-green-600 to-emerald-600 text-white py-3 px-6 rounded-lg font-semibold hover:from-green-700 hover:to-emerald-700 transition-all transform hover:scale-105"
          >
            신청 페이지로 이동
          </button>
        </div>
      </div>
    );
  }

  // Need to get number or waiting
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="bg-white p-8 rounded-2xl shadow-2xl max-w-md w-full">
        <div className="text-center mb-6">
          <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Ticket className="w-10 h-10 text-blue-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">대기열 시스템</h2>
          <p className="text-gray-600">번호표를 뽑고 순서대로 입장하세요</p>
        </div>

        {myNumber === null ? (
          // No number yet
          <div>
            <button
              onClick={getNumber}
              className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white py-4 px-6 rounded-lg font-semibold hover:from-blue-700 hover:to-indigo-700 transition-all transform hover:scale-105 mb-4"
            >
              번호표 뽑기
            </button>
            <p className="text-center text-sm text-gray-500">
              현재 대기: {Math.max(0, queueData.lastAssignedNumber - queueData.currentNumber)}명
            </p>
          </div>
        ) : (
          // Has number, waiting
          <div>
            <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-6 mb-6">
              <div className="text-center">
                <p className="text-sm text-blue-600 font-semibold mb-2">내 번호</p>
                <p className="text-5xl font-bold text-blue-900 mb-2">{myNumber}</p>
                <p className="text-sm text-blue-600">현재 입장 번호: {queueData.currentNumber}</p>
              </div>
            </div>

            {waitingAhead > 0 ? (
              <div className="bg-yellow-50 border-2 border-yellow-200 rounded-lg p-6 mb-6">
                <div className="flex items-center justify-center space-x-2">
                  <Clock className="w-6 h-6 text-yellow-600" />
                  <p className="text-lg font-semibold text-yellow-900">
                    앞 {waitingAhead}명 대기 중
                  </p>
                </div>
              </div>
            ) : (
              <div className="bg-green-50 border-2 border-green-200 rounded-lg p-6 mb-6">
                <div className="flex items-center justify-center space-x-2">
                  <CheckCircle2 className="w-6 h-6 text-green-600" />
                  <p className="text-lg font-semibold text-green-900">
                    곧 입장 가능합니다!
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-3">
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm text-gray-600 mb-2">예상 대기 시간</p>
                <p className="text-lg font-semibold text-gray-900">
                  약 {Math.ceil(waitingAhead / 2)}분
                </p>
                <p className="text-xs text-gray-500 mt-1">* 약 30초당 1명 입장</p>
              </div>

              <div className="bg-blue-50 rounded-lg p-4">
                <p className="text-sm text-blue-600 mb-1">안내</p>
                <p className="text-xs text-blue-900">
                  • 입장 순서가 되면 알림이 표시됩니다<br />
                  • 페이지를 새로고침 해도 번호는 유지됩니다<br />
                  • 입장 가능 시 자동으로 버튼이 활성화됩니다
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
