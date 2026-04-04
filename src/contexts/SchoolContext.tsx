import React, { createContext, useContext, useEffect, useState } from 'react';
/* eslint-disable react-refresh/only-export-components */
import { useParams } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/config';
import { SchoolConfig } from '../types/models';

interface SchoolContextType {
  schoolConfig: SchoolConfig | null;
  loading: boolean;
  error: string | null;
}

const SchoolContext = createContext<SchoolContextType | null>(null);

export function useSchool() {
  const context = useContext(SchoolContext);
  if (!context) {
    throw new Error('useSchool must be used within a SchoolProvider');
  }
  return context;
}

export function SchoolProvider({ children }: { children: React.ReactNode }) {
  const { schoolId } = useParams<{ schoolId: string }>();
  const [schoolConfig, setSchoolConfig] = useState<SchoolConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!schoolId) {
      setLoading(false);
      return;
    }

    const docRef = doc(db, 'schools', schoolId);
    const unsubscribe = onSnapshot(
      docRef,
      (docSnap) => {
        if (docSnap.exists()) {
          const schoolData = { ...docSnap.data(), id: docSnap.id } as SchoolConfig;
          setSchoolConfig(schoolData);
          setError(null);
          if (schoolData.id === 'snu' || schoolData.name?.includes('서울대학교')) {
            document.title = '서울대학교입학본부 예약시스템';
          } else {
            document.title = `${schoolData.name} | 행사 신청 시스템`;
          }
        } else {
          setSchoolConfig(null);
          setError('학교 정보를 찾을 수 없습니다.');
        }

        setLoading(false);
      },
      (err) => {
        console.error(err);
        setError('학교 정보를 불러오는 중 오류가 발생했습니다.');
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [schoolId]);

  return <SchoolContext.Provider value={{ schoolConfig, loading, error }}>{children}</SchoolContext.Provider>;
}
