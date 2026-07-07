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

        {/* 개발서버 전용 메모 — 매월 푸시 요청 규칙. process.env.NODE_ENV로 로컬(dev)에서만 노출, 배포(production)엔 안 뜸 */}
        {process.env.NODE_ENV === 'development' && (
          <div className="hidden select-text items-center gap-1.5 rounded border border-amber-300/40 bg-amber-400/10 px-2 py-0.5 text-[10px] leading-tight text-amber-50 lg:flex">
            <span className="font-bold text-amber-300">DEV·푸시규칙</span>
            <span className="text-blue-100/80">복사해 요청 →</span>
            <span className="text-amber-200">(자금)</span>
            <span className="text-blue-200/70">fs-jade =</span>
            <span className="rounded bg-white/15 px-1 font-mono">fs 에 푸시해줘</span>
            <span className="text-blue-200/40">|</span>
            <span className="text-amber-200">(실적)</span>
            <span className="text-blue-200/70">CNFS =</span>
            <span className="rounded bg-white/15 px-1 font-mono">cnfs 에 푸시해줘</span>
          </div>
        )}
      </div>
    </header>
  );
}
