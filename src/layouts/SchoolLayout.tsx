import React, { useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { SchoolProvider, useSchool } from '../contexts/SchoolContext';
import SchoolPopup from '../components/SchoolPopup';

function SchoolContent() {
  const { schoolConfig, loading } = useSchool();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && schoolConfig && schoolConfig.isActive === false) {
      navigate('/', { replace: true });
    }
  }, [schoolConfig, loading, navigate]);

  if (loading) {
    return <div className="min-h-screen bg-snu-gray"></div>;
  }

  if (schoolConfig?.isActive === false) {
    return null;
  }

  return <Outlet />;
}

export default function SchoolLayout() {
  return (
    <SchoolProvider>
      <SchoolPopup />
      <div className="min-h-screen bg-snu-gray font-sans text-gray-900">
        <SchoolContent />
      </div>
    </SchoolProvider>
  );
}
