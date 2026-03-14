import React, { useEffect, useState } from 'react';
import { useSchool } from '../contexts/SchoolContext';

export default function SchoolPopup() {
  const { schoolConfig } = useSchool();
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!schoolConfig?.usePopup || !schoolConfig.popupContent) return;

    const hideUntil = localStorage.getItem(`hidePopup_${schoolConfig.id}`);
    if (hideUntil) {
      const now = new Date();
      const hideDate = new Date(parseInt(hideUntil));
      if (now.getTime() < hideDate.getTime()) {
        return;
      }
    }

    setIsOpen(true);
  }, [schoolConfig]);

  const closePopup = (hideToday: boolean) => {
    if (hideToday && schoolConfig) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      localStorage.setItem(`hidePopup_${schoolConfig.id}`, tomorrow.getTime().toString());
    }
    setIsOpen(false);
  };

  if (!isOpen || !schoolConfig?.popupContent) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full overflow-hidden flex flex-col max-h-[80vh]">
        <div className="p-4 overflow-y-auto flex-1">
          <div dangerouslySetInnerHTML={{ __html: schoolConfig.popupContent }} className="prose prose-sm" />
        </div>
        <div className="bg-gray-100 p-3 flex justify-between items-center border-t shrink-0">
          <button 
            onClick={() => closePopup(true)} 
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            오늘 하루 보지 않기
          </button>
          <button 
            onClick={() => closePopup(false)} 
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
