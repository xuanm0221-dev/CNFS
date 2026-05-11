'use client';

import { JapaneseYen } from 'lucide-react';
import { BASE_MONTH } from '@/lib/base-month';

export default function Header() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-14 bg-[#1e3a5f] shadow-md">
      <div className="flex h-full items-center gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10">
            <JapaneseYen className="h-4 w-4 text-yellow-300" strokeWidth={2.5} />
          </div>
          <h1 className="text-[15px] font-bold tracking-tight text-white">
            F&amp;F CHINA 재무제표
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-blue-200">기준월</span>
          <span className="rounded border border-white/20 bg-white/10 px-2 py-1 text-xs font-medium text-white">
            {BASE_MONTH}월
          </span>
        </div>
      </div>
    </header>
  );
}
