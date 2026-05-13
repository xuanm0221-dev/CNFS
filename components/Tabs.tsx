'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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

interface TabGroup {
  id: string;
  label: string;
  tabIndexes: number[];
}

interface TabsProps {
  tabs: string[];
  activeTab: number;
  onChange: (index: number) => void;
  groups?: TabGroup[];
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

export default function Tabs({ tabs, activeTab, onChange, groups }: TabsProps) {
  const ADMIN_PW = process.env.NEXT_PUBLIC_ADMIN_PW ?? '';

  const defaultGroups = useMemo<TabGroup[]>(
    () => [
      { id: 'group1', label: '재무제표', tabIndexes: [0, 1, 2, 3] },
      { id: 'group2', label: '자금월보', tabIndexes: [5, 6, 7] },
    ],
    []
  );
  const tabGroups = groups && groups.length > 0 ? groups : defaultGroups;
  const [hiddenGroups, setHiddenGroups] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState(false);
  const hasLoadedPreferenceRef = useRef(false);

  // 비밀번호 잠금 상태
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [showPwInput, setShowPwInput] = useState(false);
  const [pwInput, setPwInput] = useState('');
  const [pwError, setPwError] = useState(false);

  const visibleTabs = useMemo(() => {
    return tabs
      .map((tab, index) => ({ tab, index }))
      .filter(({ index }) => {
        const group = tabGroups.find((g) => g.tabIndexes.includes(index));
        return !group || !hiddenGroups[group.id];
      });
  }, [tabs, tabGroups, hiddenGroups]);

  useEffect(() => {
    const activeVisible = visibleTabs.some((item) => item.index === activeTab);
    if (!activeVisible && visibleTabs.length > 0) {
      onChange(visibleTabs[0].index);
    }
  }, [activeTab, onChange, visibleTabs]);

  useEffect(() => {
    if (hasLoadedPreferenceRef.current) return;
    hasLoadedPreferenceRef.current = true;
    fetch('/data/tab-config.json')
      .then((r) => r.json())
      .then((cfg: { hiddenGroups?: Record<string, boolean> }) => {
        setHiddenGroups(cfg.hiddenGroups ?? { group1: true });
      })
      .catch(() => {
        setHiddenGroups({ group1: true });
      });
  }, [tabGroups]);

  const toggleGroup = (groupId: string) => {
    setHiddenGroups((prev) => {
      const nextHidden = !prev[groupId];
      const visibleGroupCount = tabGroups.filter((g) => !prev[g.id]).length;
      if (nextHidden && visibleGroupCount <= 1) {
        return prev;
      }
      return { ...prev, [groupId]: nextHidden };
    });
  };

  const saveAsDefault = async () => {
    const hiddenGroupsPayload: Record<string, boolean> = {};
    tabGroups.forEach((group) => {
      hiddenGroupsPayload[group.id] = !!hiddenGroups[group.id];
    });
    await fetch('/api/tab-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hiddenGroups: hiddenGroupsPayload }),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  };

  const handlePwSubmit = () => {
    if (pwInput === ADMIN_PW) {
      setIsUnlocked(true);
      setShowPwInput(false);
      setPwInput('');
      setPwError(false);
    } else {
      setPwError(true);
      setPwInput('');
    }
  };

  const handleLockClick = () => {
    if (isUnlocked) {
      setIsUnlocked(false);
    } else {
      setShowPwInput((prev) => !prev);
      setPwInput('');
      setPwError(false);
    }
  };

  return (
    <div className="fixed top-14 left-0 right-0 z-40 border-b border-slate-200 bg-slate-50 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
      <div className="flex items-center gap-2 px-3 py-2 sm:px-4">
        <div className="flex-1 overflow-x-auto">
          <div className="mx-auto flex min-w-max items-center gap-1.5">
            {visibleTabs.map(({ tab, index }) => {
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

        {/* 잠금/잠금해제 + 그룹 컨트롤 */}
        <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
          {isUnlocked && (
            <>
              {tabGroups.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => toggleGroup(group.id)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                    hiddenGroups[group.id]
                      ? 'bg-slate-200 text-slate-600 hover:bg-slate-300'
                      : 'bg-[#1e3a8a] text-white hover:bg-[#1e40af]'
                  }`}
                >
                  {group.label} {hiddenGroups[group.id] ? '표시' : '숨기기'}
                </button>
              ))}
              {process.env.NODE_ENV === 'development' && (
                <button
                  type="button"
                  onClick={saveAsDefault}
                  className="rounded-lg bg-accent-yellow px-2.5 py-1 text-xs font-semibold text-[#183766] transition-colors hover:brightness-95"
                >
                  {saved ? '저장됨' : '기본값으로 저장'}
                </button>
              )}
            </>
          )}

          {/* 비밀번호 입력 인풋 */}
          {showPwInput && !isUnlocked && (
            <div className="flex items-center gap-1">
              <input
                type="password"
                value={pwInput}
                onChange={(e) => { setPwInput(e.target.value); setPwError(false); }}
                onKeyDown={(e) => { if (e.key === 'Enter') handlePwSubmit(); if (e.key === 'Escape') { setShowPwInput(false); setPwInput(''); } }}
                placeholder="비밀번호"
                autoFocus
                className={`w-24 rounded-lg px-2 py-1 text-xs bg-white text-slate-700 placeholder-slate-400 border outline-none ${
                  pwError ? 'border-red-400' : 'border-slate-300 focus:border-[#1e3a8a]'
                }`}
              />
              <button
                type="button"
                onClick={handlePwSubmit}
                className="rounded-lg bg-[#1e3a8a] px-2 py-1 text-xs text-white hover:bg-[#1e40af]"
              >
                확인
              </button>
            </div>
          )}

          {/* 자물쇠 아이콘 버튼 */}
          <button
            type="button"
            onClick={handleLockClick}
            title={isUnlocked ? '잠금' : '관리자 잠금 해제'}
            className="rounded-lg px-2 py-1 text-sm text-slate-400 hover:text-slate-700 transition-colors"
          >
            {isUnlocked ? '🔓' : '🔒'}
          </button>
        </div>
      </div>
    </div>
  );
}
