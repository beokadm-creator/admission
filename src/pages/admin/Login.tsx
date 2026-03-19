import React, { useState } from 'react';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { useNavigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { AlertCircle, LockKeyhole, Mail } from 'lucide-react';
import { auth, db } from '../../firebase/config';

function getLoginErrorMessage(error: any) {
  const code = error?.code || '';

  if (code === 'auth/invalid-email') {
    return '이메일 형식이 올바르지 않습니다.';
  }

  if (
    code === 'auth/user-not-found' ||
    code === 'auth/wrong-password' ||
    code === 'auth/invalid-credential'
  ) {
    return '이메일 또는 비밀번호가 올바르지 않습니다.';
  }

  if (code === 'auth/too-many-requests') {
    return '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.';
  }

  return '관리자 로그인 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';
}

export default function AdminLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
      const adminDoc = await getDoc(doc(db, 'admins', credential.user.uid));

      if (!adminDoc.exists()) {
        await signOut(auth);
        setError('인증은 성공했지만 관리자 권한이 없는 계정입니다. admins 컬렉션의 권한 설정을 확인해 주세요.');
        return;
      }

      navigate('/admin');
    } catch (err: any) {
      console.error('Admin login error:', err);
      setError(getLoginErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)] px-4 py-12">
      <div className="mx-auto flex min-h-[80vh] max-w-5xl items-center justify-center">
        <div className="grid w-full overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-2xl lg:grid-cols-[1.1fr_0.9fr]">
          <div className="hidden bg-[linear-gradient(135deg,#0f172a_0%,#1d4ed8_100%)] p-10 text-white lg:block">
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-blue-100/80">Admin Console</p>
            <h1 className="mt-4 text-4xl font-black leading-tight">관리자 전용 로그인</h1>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-blue-100/85">
              Firebase Authentication에 등록된 이메일 계정으로 로그인한 뒤, Firestore `admins` 컬렉션의 권한이 확인된 사용자만 관리자 화면에 प्रवेश할 수 있습니다.
            </p>

            <div className="mt-10 space-y-4">
              <div className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur-sm">
                <p className="text-sm font-semibold">1. Firebase Auth 인증</p>
                <p className="mt-1 text-sm text-blue-100/80">이메일과 비밀번호가 정확해야 로그인됩니다.</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur-sm">
                <p className="text-sm font-semibold">2. 관리자 권한 확인</p>
                <p className="mt-1 text-sm text-blue-100/80">로그인 후 `admins/{'{uid}'}` 문서가 있어야 관리자 접근이 허용됩니다.</p>
              </div>
            </div>
          </div>

          <div className="p-8 sm:p-10">
            <div className="mx-auto max-w-md">
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-blue-600 lg:hidden">Admin Console</p>
              <h2 className="mt-2 text-3xl font-black text-slate-950">관리자 로그인</h2>
              <p className="mt-3 text-sm leading-relaxed text-slate-500">
                Firebase에 등록된 관리자 계정으로 로그인해 주세요.
              </p>

              <form className="mt-8 space-y-5" onSubmit={handleLogin}>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">이메일</span>
                  <div className="flex items-center rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 focus-within:border-blue-500 focus-within:bg-white">
                    <Mail className="mr-3 h-4 w-4 text-slate-400" />
                    <input
                      type="email"
                      required
                      autoComplete="username"
                      className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
                      placeholder="admin@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">비밀번호</span>
                  <div className="flex items-center rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 focus-within:border-blue-500 focus-within:bg-white">
                    <LockKeyhole className="mr-3 h-4 w-4 text-slate-400" />
                    <input
                      type="password"
                      required
                      autoComplete="current-password"
                      className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
                      placeholder="비밀번호를 입력해 주세요"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                </label>

                {error && (
                  <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                    <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    <p className="leading-relaxed">{error}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-2xl bg-blue-600 px-4 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                >
                  {loading ? '로그인 확인 중...' : '관리자 로그인'}
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
