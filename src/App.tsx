import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import AdminRoute from './components/AdminRoute';
import SchoolLayout from './layouts/SchoolLayout';
import AdminLayout from './layouts/AdminLayout';

// Admin Pages
import AdminLogin from './pages/admin/Login';
import AdminDashboard from './pages/admin/Dashboard';
import SchoolSettings from './pages/admin/SchoolSettings';
import SchoolList from './pages/admin/SchoolList';

// School Pages
import SchoolMain from './pages/school/Main';
import QueuePage from './pages/school/Queue';
import RegisterPage from './pages/school/Register';
import CompletePage from './pages/school/Complete';
import LookupPage from './pages/school/Lookup';
import SmartQueueGate from './components/SmartQueueGate';

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Admin Routes with AdminLayout */}
          <Route path="/admin/login" element={<AdminLogin />} />
          <Route
            path="/admin"
            element={
              <AdminRoute>
                <AdminLayout />
              </AdminRoute>
            }
          >
            <Route index element={<AdminDashboard />} />
            <Route path="schools" element={<SchoolList />} />
            <Route path="schools/:schoolId" element={<SchoolSettings />} />
          </Route>

          {/* School Routes */}
          <Route path="/:schoolId" element={<SchoolLayout />}>
            <Route index element={<SchoolMain />} />
            <Route path="gate" element={<SmartQueueGate />} />
            <Route path="queue" element={<QueuePage />} />
            <Route path="register" element={<RegisterPage />} />
            <Route path="complete" element={<CompletePage />} />
            <Route path="lookup" element={<LookupPage />} />
          </Route>

          {/* Fallback Route */}
          <Route path="/" element={<div className="p-8">학교 ID를 입력해주세요. (예: /korea-univ)</div>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
