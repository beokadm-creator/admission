import React from 'react';
import { Outlet } from 'react-router-dom';
import { SchoolProvider } from '../contexts/SchoolContext';
import SchoolPopup from '../components/SchoolPopup';

export default function SchoolLayout() {
  return (
    <SchoolProvider>
      <SchoolPopup />
      <div className="min-h-screen bg-gray-50 font-sans text-gray-900">
        <Outlet />
      </div>
    </SchoolProvider>
  );
}
