import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { clsx } from 'clsx';

interface DeviceGridProps {
  onSelect: (index: number) => void;
}

export const DeviceGrid: React.FC<DeviceGridProps> = ({ onSelect }) => {
  const [isOpen, setIsOpen] = useState(false);

  // Generate 1 to 199
  const numbers = Array.from({ length: 199 }, (_, i) => i + 1);

  return (
    <div className="bg-white rounded-lg shadow mt-4 overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 bg-gray-50 active:bg-gray-100 transition-colors"
      >
        <span className="font-bold text-gray-700">機器Noを選択 (新規/切替)</span>
        {isOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
      </button>

      {isOpen && (
        <div className="p-2 grid grid-cols-5 sm:grid-cols-8 gap-2 max-h-80 overflow-y-auto bg-gray-100 border-t">
          {numbers.map((num) => (
            <button
              key={num}
              onClick={() => {
                onSelect(num);
                setIsOpen(false);
              }}
              className={clsx(
                "p-2 text-sm font-medium rounded border shadow-sm",
                "bg-white text-gray-700 border-gray-200",
                "active:bg-blue-600 active:text-white active:border-blue-600"
              )}
            >
              {num.toString().padStart(3, '0')}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};