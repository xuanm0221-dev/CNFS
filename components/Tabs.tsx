'use client';

import { useState } from 'react';
import {
  LayoutDashboard,
  BarChart3,
  Scale,
  Banknote,
  CreditCard,
  Boxes,
  LineChart,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

interface PlSyncResult {
  ok?: boolean;
  month?: string;
  prev?: string | null;
  dryRun?: boolean;
  changed?: number | null;
  output?: string;
  error?: string;
  detail?: string;
}

interface TabsProps {
  tabs: string[];
  activeTab: number;
  onChange: (index: number) => void;
}

const TAB_ICONS: LucideIcon[] = [
  LayoutDashboard, // 0 경영요약
  BarChart3,       // 1 손익계산서
  Scale,           // 2 재무상태표
  Banknote,        // 3 현금흐름표
  CreditCard,      // 4 여신사용현황
  Boxes,           // 5 재고자산 (sim)
  LineChart,       // 6 PL (sim)
  Wallet,          // 7 CF (sim)
];

// 카테고리별 색상 구분: PL 계열(연한 민트), 재고자산 계열(연한 회색)
const TAB_TINT: Array<{ inactiveBg: string; inactiveText: string; activeRing: string } | null> = [
  null,                                                                                                   // 0 경영요약
  { inactiveBg: 'bg-emerald-50 hover:bg-emerald-100', inactiveText: 'text-emerald-700', activeRing: 'ring-1 ring-emerald-300' },  // 1 손익계산서
  null,                                                                                                   // 2 재무상태표
  null,                                                                                                   // 3 현금흐름표
  null,                                                                                                   // 4 여신사용현황
  { inactiveBg: 'bg-slate-100 hover:bg-slate-200',    inactiveText: 'text-slate-600',   activeRing: 'ring-1 ring-slate-300' },    // 5 재고자산 (sim)
  { inactiveBg: 'bg-emerald-50 hover:bg-emerald-100', inactiveText: 'text-emerald-700', activeRing: 'ring-1 ring-emerald-300' },  // 6 PL (sim)
  null,                                                                                                   // 7 CF (sim)
];

/** 손익계산서 탭 — "최신엑셀로 PL업뎃" 버튼을 여기서만 띄운다 */
const PL_TAB_INDEX = 1;

export default function Tabs({ tabs, activeTab, onChange }: TabsProps) {
  // 최신 엑셀 → PL CSV 갱신 (dev 전용). 먼저 미리보기, 확인 후 반영.
  const [plSyncBusy, setPlSyncBusy] = useState(false);
  const [plSyncResult, setPlSyncResult] = useState<PlSyncResult | null>(null);

  const runPlSync = async (dryRun: boolean) => {
    if (process.env.NODE_ENV !== 'development') return;
    setPlSyncBusy(true);
    try {
      const res = await fetch('/api/dev/pl-from-excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun }),
      });
      const json = (await res.json()) as PlSyncResult;
      setPlSyncResult(res.ok ? json : { ...json, error: json.error ?? '실행 실패' });
    } catch (e) {
      setPlSyncResult({ error: e instanceof Error ? e.message : '실행 실패' });
    } finally {
      setPlSyncBusy(false);
    }
  };

  const isDev = process.env.NODE_ENV === 'development';

  return (
    <div className="fixed top-14 left-0 right-0 z-40 border-b border-slate-200 bg-slate-50 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
      <div className="flex items-center gap-2 px-3 py-2 sm:px-4">
        <div className="flex-1 overflow-x-auto">
          <div className="mx-auto flex min-w-max items-center gap-1.5">
            {tabs.map((tab, index) => {
              const Icon = TAB_ICONS[index];
              const isActive = activeTab === index;
              const tint = TAB_TINT[index];
              const activeCls = `bg-white text-[#1e3a8a] shadow-[0_2px_8px_rgba(30,58,138,0.12),0_0_0_1px_rgba(30,58,138,0.08)] -translate-y-px ${tint?.activeRing ?? ''}`;
              const inactiveCls = tint
                ? `${tint.inactiveBg} ${tint.inactiveText}`
                : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700';
              return (
                <button
                  key={index}
                  onClick={() => onChange(index)}
                  className={`
                    relative flex items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2 text-sm font-semibold tracking-tight transition-all duration-150
                    ${isActive ? activeCls : inactiveCls}
                  `}
                  aria-current={isActive ? 'page' : undefined}
                >
                  {Icon && <Icon className="h-4 w-4" strokeWidth={isActive ? 2.25 : 2} />}
                  {tab}
                </button>
              );
            })}
          </div>
        </div>

        {/* 최신엑셀로 PL업뎃 — dev + 손익계산서 탭에서만 */}
        {isDev && activeTab === PL_TAB_INDEX && (
          <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
            <button
              type="button"
              onClick={() => runPlSync(true)}
              disabled={plSyncBusy}
              title="엑셀파일(git푸시제외) 의 최신 월 폴더에서 PL CSV 를 갱신합니다 (먼저 미리보기)"
              className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
            >
              {plSyncBusy ? '확인 중…' : '최신엑셀로 PL업뎃'}
            </button>
          </div>
        )}
      </div>

      {/* PL 업뎃 결과 패널 (dev) */}
      {isDev && plSyncResult && (
        <div className="absolute right-3 top-full z-50 mt-1 w-[min(760px,92vw)] rounded-xl border border-slate-300 bg-white p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-slate-800">
              {plSyncResult.error
                ? 'PL 업뎃 실패'
                : plSyncResult.dryRun
                  ? `미리보기 — 엑셀 ${plSyncResult.month}${plSyncResult.prev ? ` (기존 ${plSyncResult.prev})` : ''}`
                  : `반영 완료 — 엑셀 ${plSyncResult.month}${plSyncResult.prev ? ` (기존 ${plSyncResult.prev})` : ''}`}
            </div>
            <div className="flex items-center gap-1.5">
              {plSyncResult.dryRun && !plSyncResult.error && (plSyncResult.changed ?? 0) > 0 && (
                <button
                  type="button"
                  onClick={() => runPlSync(false)}
                  disabled={plSyncBusy}
                  className="rounded-lg bg-[#1e3a8a] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#1e40af] disabled:opacity-50"
                >
                  {plSyncBusy ? '반영 중…' : `${plSyncResult.changed}개 셀 반영하기`}
                </button>
              )}
              <button
                type="button"
                onClick={() => setPlSyncResult(null)}
                className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
              >
                닫기
              </button>
            </div>
          </div>
          {plSyncResult.dryRun && !plSyncResult.error && (plSyncResult.changed ?? 0) === 0 && (
            <div className="mb-2 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-800">
              엑셀과 CSV 가 일치합니다. 반영할 것이 없습니다.
            </div>
          )}
          {!plSyncResult.dryRun && !plSyncResult.error && (
            <div className="mb-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
              CSV 가 갱신됐습니다. 배포본에 반영하려면 커밋·푸시가 필요합니다.
            </div>
          )}
          <pre className="max-h-[46vh] overflow-auto whitespace-pre-wrap rounded-lg bg-slate-900 p-2.5 text-[11px] leading-relaxed text-slate-100">
            {plSyncResult.error
              ? `${plSyncResult.error}\n${plSyncResult.detail ?? ''}`
              : plSyncResult.output}
          </pre>
        </div>
      )}
    </div>
  );
}
