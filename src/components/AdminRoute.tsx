import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function AdminRoute({ children }: { children: React.ReactNode }) {
  const { currentUser, adminProfile, loading } = useAuth();

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  if (!currentUser || !adminProfile) {
    return <Navigate to="/admin/login" replace />;
  }

  return <>{children}</>;
}
