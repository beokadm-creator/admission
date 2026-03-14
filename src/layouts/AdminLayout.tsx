import React, { useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase/config';

export default function AdminLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { adminProfile } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      navigate('/admin/login');
    } catch (error) {
      console.error('Sign out error:', error);
    }
  };

  const menuItems = adminProfile?.role === 'MASTER' ? [
    { name: '대시보드', path: '/admin', icon: '📊' },
    { name: '학교 관리', path: '/admin/schools', icon: '🏫' },
  ] : [
    { name: '대시보드', path: '/admin', icon: '📊' },
    { name: '학교 설정', path: `/admin/schools/${adminProfile?.assignedSchoolId}`, icon: '⚙️' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sidebar */}
      <div className={`fixed left-0 top-0 h-full bg-gray-900 text-white transition-all duration-300 ${sidebarOpen ? 'w-64' : 'w-20'} z-50`}>
        <div className="p-4 border-b border-gray-700">
          <h1 className={`font-bold text-xl ${!sidebarOpen && 'hidden'}`}>
            관리자 시스템
          </h1>
          {!sidebarOpen && <span className="text-2xl">⚡</span>}
        </div>

        <nav className="p-4">
          <ul className="space-y-2">
            {menuItems.map((item) => {
              const isActive = location.pathname === item.path || location.pathname.startsWith(item.path + '/');
              return (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    className={`flex items-center p-3 rounded-lg transition-colors ${
                      isActive
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                    }`}
                  >
                    <span className="text-xl mr-3">{item.icon}</span>
                    {sidebarOpen && <span>{item.name}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-gray-700">
          <button
            onClick={handleSignOut}
            className="flex items-center w-full p-3 rounded-lg text-red-400 hover:bg-gray-800 hover:text-red-300 transition-colors"
          >
            <span className="text-xl mr-3">🚪</span>
            {sidebarOpen && <span>로그아웃</span>}
          </button>
        </div>
      </div>

      {/* Toggle Button */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="fixed left-0 top-1/2 transform -translate-y-1/2 bg-blue-600 text-white p-2 rounded-r-lg hover:bg-blue-700 z-50 transition-all"
        style={{ left: sidebarOpen ? '16rem' : '5rem' }}
      >
        {sidebarOpen ? '◀' : '▶'}
      </button>

      {/* Main Content */}
      <div className={`transition-all duration-300 ${sidebarOpen ? 'ml-64' : 'ml-20'}`}>
        <header className="bg-white shadow-sm">
          <div className="px-8 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">
                  {adminProfile?.role === 'MASTER' ? '마스터 관리자' : '학교 관리자'}
                </h2>
                <p className="text-sm text-gray-500">{adminProfile?.email}</p>
              </div>
            </div>
          </div>
        </header>

        <main className="p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
