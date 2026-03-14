import React, { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../../firebase/config';
import { doc, setDoc } from 'firebase/firestore';

export default function AdminLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      setError('');
      await signInWithEmailAndPassword(auth, email, password);
      navigate('/admin');
    } catch (err: unknown) {
      console.error('Login error:', err);
      setError('로그인에 실패했습니다. 이메일과 비밀번호를 확인해주세요.');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAdmin = async () => {
    if (!auth.currentUser) {
      alert('먼저 로그인을 시도해주세요 (로그인 실패 상태라도 Auth 객체에는 유저가 있을 수 있음)');
      return;
    }
    try {
      await setDoc(doc(db, 'admins', auth.currentUser.uid), {
        id: auth.currentUser.uid,
        email: auth.currentUser.email,
        name: 'Admin',
        role: 'MASTER',
        createdAt: Date.now()
      }, { merge: true });
      alert('관리자 권한이 부여되었습니다! 다시 로그인해주세요.');
      window.location.reload();
    } catch (err) {
      console.error(err);
      alert('권한 부여 실패: ' + err);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            관리자 로그인
          </h2>
        </div>
        <form className="mt-8 space-y-6" onSubmit={handleLogin}>
          <div className="rounded-md shadow-sm -space-y-px">
            <div>
              <input
                type="email"
                required
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-t-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
                placeholder="이메일 주소"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <input
                type="password"
                required
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-b-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
                placeholder="비밀번호"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          {error && <div className="text-red-500 text-sm text-center">{error}</div>}

          <div>
            <button
              type="submit"
              disabled={loading}
              className={`group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {loading ? '로그인 중...' : '로그인'}
            </button>
          </div>
          
          <div className="text-center mt-4">
            <button
              type="button"
              onClick={handleCreateAdmin}
              className="text-sm text-gray-500 hover:text-gray-700 underline"
            >
              (임시) 현재 로그인된 계정에 관리자 권한 부여
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
