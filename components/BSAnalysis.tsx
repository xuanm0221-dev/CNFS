'use client';
import { useState } from 'react';
import { PieChart, ChevronDown, ChevronRight } from 'lucide-react';
import { TableRow } from '@/lib/types';

interface BSAnalysisProps {
  bsData: TableRow[];
  year: number; // 2025 또는 2026
  previousYearData?: TableRow[]; // YoY 계산용
}

export default function BSAnalysis({ bsData, year, previousYearData }: BSAnalysisProps) {
  const [loanLimitOpen, setLoanLimitOpen] = useState(false);
  
  // 월 인덱스 (26년·25년 모두 기말 12월 기준)
  const month = 11; // 기말(12월)
  const prevMonth = 11; // 전년 12월
  
  // 값 추출 함수
  const getAccountValue = (account: string, data: TableRow[], monthIdx: number) => {
    const row = data.find(r => r.account === account);
    return row?.values[monthIdx] || 0;
  };
  
  // 당년 재무제표 값
  const 자산 = getAccountValue('자산', bsData, month);
  const 부채 = getAccountValue('부채', bsData, month);
  const 자본 = getAccountValue('자본', bsData, month);
  const 유동자산 = getAccountValue('유동자산', bsData, month);
  const 유동부채 = getAccountValue('유동부채', bsData, month);
  const 차입금 = getAccountValue('차입금', bsData, month);
  const 이익잉여금 = getAccountValue('이익잉여금', bsData, month);
  
  // 전년 값 (YoY 계산용)
  const 전년자본 = previousYearData ? getAccountValue('자본', previousYearData, prevMonth) : 0;
  const 전년부채 = previousYearData ? getAccountValue('부채', previousYearData, prevMonth) : 0;
  const 전년자산 = previousYearData ? getAccountValue('자산', previousYearData, prevMonth) : 0;
  const 전년차입금 = previousYearData ? getAccountValue('차입금', previousYearData, prevMonth) : 0;
  const 전년이익잉여금 = previousYearData ? getAccountValue('이익잉여금', previousYearData, prevMonth) : 0;
  
  // 당기순이익 계산 (이익잉여금 YoY, M 단위)
  const 당기순이익 = (이익잉여금 - 전년이익잉여금) / 1000000; // M 단위
  
  // 재무비율 계산
  const 부채비율 = 자본 !== 0 ? (부채 / 자본) * 100 : 0;
  const 차입금비율 = 자산 !== 0 ? (차입금 / 자산) * 100 : 0;
  const 유동비율 = 유동부채 !== 0 ? (유동자산 / 유동부채) * 100 : 0;
  const ROE = 자본 !== 0 ? (당기순이익 * 1000000 / 자본) * 100 : 0;
  
  // 전년 비율
  const 전년부채비율 = 전년자본 !== 0 ? (전년부채 / 전년자본) * 100 : 0;
  const 전년차입금비율 = 전년자산 !== 0 ? (전년차입금 / 전년자산) * 100 : 0;
  
  // 차입금 변동 계산
  const 차입금변동 = 차입금 - 전년차입금;
  const 차입금변동액 = Math.abs(차입금변동) / 1000000; // M 단위
  const 차입금변동방향 = 차입금변동 > 0 ? '증가' : '상환';
  
  // 차입가능한도 state
  const [loanLimits, setLoanLimits] = useState({
    합계: { current: 1050000, total: 1050000 },
    산업은행: { current: 120000, total: 120000 },
    조상은행: { current: 150000, total: 150000 },
    KDB: { current: 140000, total: 140000 },
    KB: { current: 140000, total: 140000 },
    중국은행: { current: 200000, total: 200000 },
    광대은행: { current: 200000, total: 200000 },
    공상은행: { current: 100000, total: 100000 },
  });
  
  const updateLoanLimit = (bank: string, field: 'current' | 'total', value: number) => {
    setLoanLimits(prev => ({
      ...prev,
      [bank]: { ...prev[bank as keyof typeof prev], [field]: value }
    }));
  };
  
  // 천단위 콤마 포맷팅
  const formatWithCommas = (value: number): string => {
    return value.toLocaleString('ko-KR');
  };
  
  // 콤마 제거 및 숫자 파싱
  const parseNumber = (value: string): number => {
    const cleaned = value.replace(/,/g, '');
    const num = Number(cleaned);
    return isNaN(num) ? 0 : num;
  };
  
  return (
    <div className="px-6 pb-6">
      {/* 제목 */}
      <div className="mb-6 border-t border-slate-200 pt-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-md ring-1 ring-white/40">
            <PieChart className="h-5 w-5 text-white" strokeWidth={2.5} />
          </div>
          <h2 className="bg-gradient-to-r from-slate-900 to-slate-600 bg-clip-text text-xl font-bold tracking-tight text-transparent">
            재무비율 분석 ({year}년 기말 기준)
          </h2>
        </div>
      </div>

      {/* 4개 재무비율 카드 */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {/* 부채비율 */}
        <div className="rounded-2xl bg-emerald-50/40 ring-1 ring-emerald-100 shadow-sm p-5">
          <div className="text-xs font-semibold text-emerald-700 mb-1">부채비율</div>
          <div className="text-3xl font-bold text-emerald-700">
            {부채비율.toFixed(0)}%
          </div>
          <div className="text-xs text-slate-500 mt-1">
            ({year - 1}년말 {전년부채비율.toFixed(0)}%)
          </div>
          <div className="mt-3 text-xs text-slate-600 leading-relaxed">
            {year - 1}년말 대비 {Math.abs(부채비율 - 전년부채비율).toFixed(0)}%p {부채비율 < 전년부채비율 ? '개선' : '악화'}<br/>
            {차입금변동방향 === '상환' ? '차입금 상환 및 자본 증가' : '차입금 증가'}
          </div>
        </div>

        {/* 차입금비율 */}
        <div className="rounded-2xl bg-blue-50/40 ring-1 ring-blue-100 shadow-sm p-5">
          <div className="text-xs font-semibold text-blue-700 mb-1">차입금비율</div>
          <div className="text-3xl font-bold text-blue-700">
            {차입금비율.toFixed(0)}%
          </div>
          <div className="text-xs text-slate-500 mt-1">
            ({year - 1}년말 {전년차입금비율.toFixed(0)}%)
          </div>
          <div className="mt-3 text-xs text-slate-600 leading-relaxed">
            차입금 {차입금변동액.toFixed(0)}M {차입금변동방향}으로<br/>
            {Math.abs(차입금비율 - 전년차입금비율).toFixed(0)}%p {차입금비율 < 전년차입금비율 ? '개선' : '악화'}
          </div>
        </div>

        {/* 유동비율 */}
        <div className="rounded-2xl bg-indigo-50/40 ring-1 ring-indigo-100 shadow-sm p-5">
          <div className="text-xs font-semibold text-indigo-700 mb-1">유동비율</div>
          <div className="text-3xl font-bold text-indigo-700">
            {유동비율.toFixed(0)}%
          </div>
          <div className="text-xs text-slate-500 mt-1">(양호)</div>
          <div className="mt-3 text-xs text-slate-600 leading-relaxed">
            단기 채무상환<br/>
            능력 양호
          </div>
        </div>

        {/* ROE */}
        <div className="rounded-2xl bg-orange-50/40 ring-1 ring-orange-100 shadow-sm p-5">
          <div className="text-xs font-semibold text-orange-700 mb-1">자기자본순이익률</div>
          <div className="text-3xl font-bold text-orange-700">
            {ROE.toFixed(1)}%
          </div>
          <div className="text-xs text-slate-500 mt-1">
            (연간 기준)
          </div>
          <div className="mt-3 text-xs text-slate-600 leading-relaxed">
            당기순이익 {당기순이익.toFixed(0)}M<br/>
            안정적 수익성 유지
          </div>
        </div>
      </div>
      
      {/* 해석 + 차입가능한도 2열 레이아웃 */}
      <div className="grid grid-cols-2 gap-4">
        {/* 좌측: 해석 박스 */}
        <div className="rounded-2xl bg-sky-50/40 ring-1 ring-sky-100 shadow-sm p-5">
          <h3 className="font-bold text-sky-700 mb-3 flex items-center gap-2">💡 해석</h3>
          <div className="rounded-lg bg-white border-l-4 border-sky-400 p-3 shadow-sm">
            <ul className="text-sm text-slate-700 space-y-1.5 leading-relaxed">
              <li>• 부채비율 {부채비율.toFixed(0)}%: {year - 1}년말 {전년부채비율.toFixed(0)}% 대비 {Math.abs(부채비율 - 전년부채비율).toFixed(0)}%p {부채비율 < 전년부채비율 ? '개선' : '악화'}, 재무 안정성 {부채비율 < 전년부채비율 ? '크게 향상' : '관리 필요'}</li>
              <li>• 유동비율 {유동비율.toFixed(0)}%: 단기 채무상환 능력 양호</li>
              <li>• ROE {ROE.toFixed(1)}%: 연간 순이익 {당기순이익.toFixed(0)}M, 안정적 수익성 유지</li>
              <li>• 차입금비율 {차입금비율.toFixed(0)}%: {year - 1}년말 {전년차입금비율.toFixed(0)}% 대비 {Math.abs(차입금비율 - 전년차입금비율).toFixed(0)}%p {차입금비율 < 전년차입금비율 ? '개선' : '악화'}, 차입금 {차입금변동액.toFixed(0)}M {차입금변동방향}</li>
            </ul>
          </div>
        </div>

        {/* 우측: 차입가능한도 테이블 */}
        <div className="rounded-2xl bg-amber-50/40 ring-1 ring-amber-100 shadow-sm overflow-hidden">
        <button
          onClick={() => setLoanLimitOpen(!loanLimitOpen)}
          className="w-full px-5 py-4 flex items-center justify-between transition-colors hover:bg-amber-50/60"
        >
          <h3 className="font-bold text-amber-700 flex items-center gap-2">
            💰 차입가능한도
          </h3>
          <span className="inline-flex items-center text-slate-400">
            {loanLimitOpen
              ? <ChevronDown className="h-4 w-4" strokeWidth={2.5} />
              : <ChevronRight className="h-4 w-4" strokeWidth={2.5} />}
          </span>
        </button>
        
        {loanLimitOpen && (
          <div className="px-5 pb-5">
            <div className="rounded-xl bg-white shadow-sm overflow-hidden ring-1 ring-amber-100">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-amber-50">
                  <th className="border-b border-amber-100 py-2 px-3 text-center font-semibold text-amber-900">은행명</th>
                  <th className="border-b border-amber-100 py-2 px-3 text-center font-semibold text-amber-900">2026년1월</th>
                  <th className="border-b border-amber-100 py-2 px-3 text-center font-semibold text-amber-900">총 한도</th>
                </tr>
              </thead>
              <tbody>
                <tr className="bg-amber-50/40 font-semibold">
                  <td className="border-b border-amber-100 py-2 px-3 font-semibold text-amber-900">▼ 합계</td>
                  <td className="border-b border-amber-100 py-2 px-3">
                    <input
                      type="text"
                      value={formatWithCommas(loanLimits.합계.current)}
                      onChange={(e) => updateLoanLimit('합계', 'current', parseNumber(e.target.value))}
                      className="w-full px-2 py-1 text-right bg-transparent focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </td>
                  <td className="border-b border-amber-100 py-2 px-3">
                    <input
                      type="text"
                      value={formatWithCommas(loanLimits.합계.total)}
                      onChange={(e) => updateLoanLimit('합계', 'total', parseNumber(e.target.value))}
                      className="w-full px-2 py-1 text-right bg-transparent focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </td>
                </tr>
                {Object.entries(loanLimits)
                  .filter(([name]) => name !== '합계')
                  .map(([name, limits]) => (
                    <tr key={name}>
                      <td className="border-b border-amber-100 py-2 px-3">{name}</td>
                      <td className="border-b border-amber-100 py-2 px-3">
                        <input
                          type="text"
                          value={formatWithCommas(limits.current)}
                          onChange={(e) => updateLoanLimit(name, 'current', parseNumber(e.target.value))}
                          className="w-full px-2 py-1 text-right bg-transparent focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      </td>
                      <td className="border-b border-amber-100 py-2 px-3">
                        <input
                          type="text"
                          value={formatWithCommas(limits.total)}
                          onChange={(e) => updateLoanLimit(name, 'total', parseNumber(e.target.value))}
                          className="w-full px-2 py-1 text-right bg-transparent focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}

