import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

export default function AdminDashboard() {
  const { adminProfile, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && adminProfile) {
      if (adminProfile.role === 'MASTER') {
        navigate('/admin/schools');
      } else if (adminProfile.role === 'SCHOOL' && adminProfile.assignedSchoolId) {
        navigate(`/admin/schools/${adminProfile.assignedSchoolId}`);
      } else {
        // Fallback or error
        console.error('Invalid role or missing assignedSchoolId');
      }
    }
  }, [adminProfile, loading, navigate]);

  return <div className="p-8">Loading dashboard...</div>;
}
