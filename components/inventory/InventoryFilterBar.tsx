'use client';

import { useState, useEffect, useRef } from 'react';
import type { ScenarioKey, SalesBrand } from '@/components/pl-forecast/plForecastConfig';
import { SCENARIO_DEFS, SCENARIO_ORDER } from '@/components/pl-forecast/plForecastConfig';

const YEARS = [2025, 2026];

/** 성장률 입력 컨트롤 — 표 제목 우측용 */
export interface GrowthRateControlProps {
  label: string;
  labelCn: string;
  value: number;
  onChange: (displayedMinus100: number) => void;
  title?: string;
}
export function GrowthRateControl({ label, labelCn, value, onChange, title }: GrowthRateControlProps) {
  return (
    <div className="flex items-center gap-2" title={title}>
      <div className="flex flex-col">
        <span className="text-xs font-medium text-gray-800 leading-tight">{label}</span>
        <span className="text-[10px] text-gray-500 leading-tight">{labelCn}</span>
      </div>
      <div className="flex items-center border border-gray-300 rounded-md overflow-hidden bg-white">
        <input
          type="number"
          min={0}
          max={200}
          step={1}
          value={value}
          onChange={(e) => {
            const raw = e.target.value === '' ? 100 : Number(e.target.value);
            const clamped = Math.min(200, Math.max(0, Math.round(raw)));
            onChange(clamped - 100);
          }}
          onBlur={(e) => {
            const raw = e.target.value === '' ? 100 : Number(e.target.value);
            const clamped = Math.min(200, Math.max(0, Math.round(raw)));
            onChange(clamped - 100);
          }}
          className="w-14 py-1.5 pl-2 pr-1 text-sm text-right font-medium text-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        <div className="flex flex-col border-l border-gray-200 bg-gray-50">
          <button
            type="button"
            onClick={() => onChange(Math.min(100, value - 100 + 1))}
            className="flex items-center justify-center w-6 h-[18px] text-gray-500 hover:bg-gray-200 hover:text-gray-700 transition-colors"
            aria-label="증가"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M5 2L8 6H2z" /></svg>
          </button>
          <button
            type="button"
            onClick={() => onChange(Math.max(-100, value - 100 - 1))}
            className="flex items-center justify-center w-6 h-[18px] text-gray-500 hover:bg-gray-200 hover:text-gray-700 transition-colors border-t border-gray-200"
            aria-label="감소"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M2 4h6L5 8z" /></svg>
          </button>
        </div>
      </div>
      <span className="text-sm font-medium text-gray-600">%</span>
    </div>
  );
}

interface Props {
  year: number;
  onYearChange: (y: number) => void;
  snapshotSaved: boolean;
  snapshotSavedAt: string | null;
  recalcLoading: boolean;
  statusLoading: boolean;
  statusError: boolean;
  canSave: boolean;
  onSave: () => void;
  onRecalc: (mode: 'current' | 'annual') => void;
  allBrandsBgLoaded?: boolean;
  brandBgLoadedCount?: number;
  totalBrands?: number;
  scenarioInvStatus?: Record<ScenarioKey, 'idle' | 'computing' | 'done' | 'error'>;
  scenarioInvClosing?: Partial<Record<ScenarioKey, Partial<Record<SalesBrand, number>>>> | null;
  scenarioInvSavedAt?: string | null;
  onComputeScenarioInv?: () => void;
  onDownloadSnapshot?: () => Promise<void> | void;
}

export default function InventoryFilterBar({
  year,
  onYearChange,
  snapshotSaved,
  snapshotSavedAt,
  recalcLoading,
  statusLoading,
  statusError,
  canSave,
  onSave,
  onRecalc,
  allBrandsBgLoaded = false,
  brandBgLoadedCount = 0,
  totalBrands = 3,
  scenarioInvStatus,
  scenarioInvClosing,
  scenarioInvSavedAt,
  onComputeScenarioInv,
  onDownloadSnapshot,
}: Props) {
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const handleDownloadSnapshot = async () => {
    if (!onDownloadSnapshot) return;
    setSnapshotBusy(true);
    try { await onDownloadSnapshot(); } finally { setSnapshotBusy(false); }
  };
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // 드롭다운 외부 클릭 시 닫기
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="sticky top-0 z-40 bg-white border-b border-gray-200 shadow-sm">
      {/* 1레벨: 연도 탭 | 브랜드 · 저장 (한 줄) */}
      <div className="flex flex-wrap items-center gap-4 px-6 py-2.5 border-b border-gray-200 bg-gray-50">
        {/* 연도 탭 */}
        <div className="flex">
          {YEARS.map((y) => (
            <button
              key={y}
              onClick={() => onYearChange(y)}
              className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                year === y
                  ? 'border-blue-600 text-blue-700 bg-white'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {y}년
            </button>
          ))}
        </div>

        <div className="h-4 w-px bg-gray-300 flex-shrink-0" />

        {/* 재고,리테일,출고,입고 저장 / 저장완료+재계산 — 2025년은 확정 실적이므로 미표시 */}
        {year !== 2025 && (
          !snapshotSaved ? (
            <button
              type="button"
              onClick={onSave}
              disabled={!canSave || recalcLoading}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border transition-colors ${
                canSave
                  ? 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50 hover:border-blue-400'
                  : 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
              }`}
              title="현재 데이터를 로컬에 저장합니다"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" className="text-gray-500">
                <path d="M10 1H3L1 3v8h10V1zm-4 9a2 2 0 1 1 0-4 2 2 0 0 1 0 4zM3 1v3h5V1H3z"/>
              </svg>
              재고,리테일,출고,입고 저장
            </button>
          ) : (
            <div className="relative flex items-center gap-2" ref={dropdownRef}>
              <div className="flex">
                <button
                  type="button"
                  onClick={onSave}
                  disabled={recalcLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-l border bg-[#8b7bb8] text-white border-[#7a6aa7] hover:bg-[#7a6aa7] transition-colors"
                  title="다시 저장"
                >
                  {recalcLoading ? (
                    <svg className="animate-spin" width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="2" strokeDasharray="8 8" />
                    </svg>
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                      <path d="M1.5 6.5L4.5 9.5L10.5 3" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                  재고,리테일,출고,입고 저장완료
                </button>
                <button
                  type="button"
                  onClick={() => setDropdownOpen((v) => !v)}
                  disabled={recalcLoading}
                  className="flex items-center justify-center px-2 py-1.5 text-xs font-medium rounded-r border border-l-0 bg-[#8b7bb8] text-white border-[#7a6aa7] hover:bg-[#7a6aa7] transition-colors"
                  aria-label="재계산 메뉴"
                >
                  {dropdownOpen ? '▲' : '▼'}
                </button>
              </div>
              {dropdownOpen && (
                <div className="absolute top-full right-0 mt-1 bg-white border border-gray-200 rounded shadow-md z-50 min-w-[130px] py-1">
                  <button
                    type="button"
                    onClick={() => { onRecalc('current'); setDropdownOpen(false); }}
                    className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    당월 재계산
                  </button>
                  <div className="border-t border-gray-100 mx-2" />
                  <button
                    type="button"
                    onClick={() => { onRecalc('annual'); setDropdownOpen(false); }}
                    className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    연간 재계산
                  </button>
                </div>
              )}
            </div>
          )
        )}

        <div
          className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium shadow-sm ${
            statusLoading
              ? 'border-amber-300 bg-amber-50 text-amber-700'
              : statusError
                ? 'border-red-200 bg-red-50 text-red-600'
                : allBrandsBgLoaded
                  ? 'border-emerald-400 bg-emerald-100 text-emerald-800'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-700'
          }`}
        >
          {statusLoading
            ? '데이터 로딩중'
            : statusError
              ? '오류'
              : allBrandsBgLoaded
                ? '3개 브랜드 로딩완료'
                : (
                  <>
                    <span className="font-mono tracking-tight">
                      {'█'.repeat(brandBgLoadedCount)}{'░'.repeat(totalBrands - brandBgLoadedCount)}
                    </span>
                    <span>{brandBgLoadedCount}/{totalBrands}</span>
                  </>
                )}
        </div>

        {/* 시나리오 재고 계산 상태 뱃지 */}
        {scenarioInvStatus && (
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="h-4 w-px bg-gray-300 flex-shrink-0" />
            {SCENARIO_ORDER.map((scKey) => {
              const def = SCENARIO_DEFS[scKey];
              const status = scenarioInvStatus[scKey];
              const closing = scenarioInvClosing?.[scKey];
              const total = closing
                ? Object.values(closing).reduce((s, v) => s + (v ?? 0), 0)
                : null;

              const badgeClass =
                status === 'done'
                  ? 'border-emerald-400 bg-emerald-50 text-emerald-800'
                  : status === 'computing'
                    ? 'border-blue-300 bg-blue-50 text-blue-700'
                    : status === 'error'
                      ? 'border-red-300 bg-red-50 text-red-600'
                      : 'border-gray-200 bg-gray-50 text-gray-400';

              return (
                <div
                  key={scKey}
                  className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium ${badgeClass}`}
                  title={total != null ? `${def.label} 기말재고 합계: ${Math.round(total).toLocaleString()} K CNY (TAG)` : def.label}
                >
                  {status === 'computing' && (
                    <svg className="animate-spin" width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <circle cx="5" cy="5" r="4" stroke="currentColor" strokeWidth="1.5" strokeDasharray="6 6" />
                    </svg>
                  )}
                  {status === 'done' && <span>✓</span>}
                  {status === 'error' && <span>✗</span>}
                  <span>{def.shortLabel}</span>
                  {total != null && (
                    <span className="font-mono text-[10px] opacity-75">
                      {Math.round(total / 1000).toLocaleString()}M
                    </span>
                  )}
                </div>
              );
            })}
            <button
              type="button"
              onClick={onComputeScenarioInv}
              disabled={!onComputeScenarioInv || SCENARIO_ORDER.some((k) => scenarioInvStatus[k] === 'computing')}
              className="flex items-center gap-1 rounded-full border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
              title={scenarioInvSavedAt ? `마지막 저장: ${new Date(scenarioInvSavedAt).toLocaleString('ko-KR')}` : '시나리오 재고를 계산하고 JSON으로 저장합니다'}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M5 1v3M5 9V6M1 5h3M9 5H6" />
              </svg>
              재계산·저장
            </button>
            {onDownloadSnapshot && (
              <button
                type="button"
                onClick={handleDownloadSnapshot}
                disabled={snapshotBusy}
                className="flex items-center gap-1 rounded-full border border-amber-400 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700 shadow-sm hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
                title="SCENARIO_DEFS 기본 성장률 기준으로 시나리오 전체를 계산해 보조파일(simu)/scenario_inventory_closing.json 에 직접 저장합니다. 저장 후 git commit/push 하면 외부 사용자의 기본 스냅샷이 갱신됩니다. (개발자 전용, 재계산·저장과 무관)"
              >
                {snapshotBusy ? (
                  <svg className="animate-spin" width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <circle cx="5" cy="5" r="4" stroke="currentColor" strokeWidth="1.5" strokeDasharray="6 6" />
                  </svg>
                ) : (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M5 1v6M2 5l3 3 3-3M1 9h8" />
                  </svg>
                )}
                {snapshotBusy ? '저장중…' : '기본 스냅샷 저장 (dev)'}
              </button>
            )}
            <span className="text-[11px] font-bold leading-snug text-red-600 max-w-xl pl-0.5">
              성장률 조정 후 [재계산·저장]을 클릭하면 변경 내용이 시나리오(PL)에 반영됩니다.
              <br />
              ※ 시뮬레이션용으로만 적용되며, 실제 대시보드에는 저장되지 않습니다.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
