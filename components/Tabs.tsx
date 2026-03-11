'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

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

export default function Tabs({ tabs, activeTab, onChange, groups }: TabsProps) {
  const STORAGE_KEY = 'dashboard_tab_hidden_groups_v1';
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
        const globalDefault = cfg.hiddenGroups ?? { group1: true };
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (raw) {
            const parsed = JSON.parse(raw) as Record<string, boolean>;
            const next: Record<string, boolean> = {};
            tabGroups.forEach((group) => {
              if (parsed[group.id] === true) next[group.id] = true;
            });
            setHiddenGroups(next);
          } else {
            setHiddenGroups(globalDefault);
          }
        } catch {
          setHiddenGroups(globalDefault);
        }
      })
      .catch(() => {
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (!raw) { setHiddenGroups({ group1: true }); return; }
          const parsed = JSON.parse(raw) as Record<string, boolean>;
          const next: Record<string, boolean> = {};
          tabGroups.forEach((group) => {
            if (parsed[group.id] === true) next[group.id] = true;
          });
          setHiddenGroups(next);
        } catch {
          setHiddenGroups({ group1: true });
        }
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(hiddenGroupsPayload));
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  };

  return (
    <div className="fixed top-0 left-0 right-0 z-50 border-b border-white/20 bg-gradient-to-r from-[#173a72]/95 via-[#2458a6]/95 to-[#1c3f7b]/95 shadow-[0_8px_28px_rgba(8,22,49,0.32)] backdrop-blur-md">
      <div className="flex items-center gap-2 px-3 py-2 sm:px-4">
        <div className="flex-1 overflow-x-auto">
          <div className="mx-auto flex min-w-max items-center gap-2">
            {visibleTabs.map(({ tab, index }) => (
              <button
                key={index}
                onClick={() => onChange(index)}
                className={`
                  relative whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-semibold tracking-[0.01em] transition-all duration-200
                  ${activeTab === index
                    ? 'bg-white/18 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.28),0_8px_20px_rgba(5,16,37,0.22)]'
                    : 'text-blue-100/90 hover:bg-white/10 hover:text-white'}
                `}
                aria-current={activeTab === index ? 'page' : undefined}
              >
                {tab}
                {activeTab === index && (
                  <span className="absolute -bottom-[3px] left-1/2 h-1.5 w-8 -translate-x-1/2 rounded-full bg-accent-yellow shadow-[0_0_12px_rgba(242,201,76,0.65)]" />
                )}
              </button>
            ))}
          </div>
        </div>
        {process.env.NODE_ENV === 'development' && (
          <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
            {tabGroups.map((group) => (
              <button
                key={group.id}
                type="button"
                onClick={() => toggleGroup(group.id)}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                  hiddenGroups[group.id]
                    ? 'bg-white/10 text-blue-100 hover:bg-white/15'
                    : 'bg-white/20 text-white hover:bg-white/30'
                }`}
              >
                {group.label} {hiddenGroups[group.id] ? '표시' : '숨기기'}
              </button>
            ))}
            <button
              type="button"
              onClick={saveAsDefault}
              className="rounded-lg bg-accent-yellow px-2.5 py-1 text-xs font-semibold text-[#183766] transition-colors hover:brightness-95"
            >
              {saved ? '저장됨' : '기본값으로 저장'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}



