'use client';

/**
 * 사업계획 진입점 — 좌측 사이드바로 화면을 고른다.
 *   첫화면
 *   연간손익        · 법인 / MLB / MLB KIDS / DISCOVERY / DUVETICA / SUPRA
 *   영업이익 Bridge · 법인 / MLB / MLB KIDS / DISCOVERY / DUVETICA / SUPRA
 * 헤더의 [사업계획] 버튼이 이 컴포넌트를 전체화면으로 띄운다.
 */
import { useState } from 'react';
import BusinessPlanHub from './BusinessPlanHub';
import BusinessPlanView from './BusinessPlanView';
import BridgeView from './bridge/BridgeView';
import { BP_BRANDS, BrandKey } from './shared';

type View =
  | { kind: 'hub' }
  | { kind: 'pl'; brand: BrandKey }
  | { kind: 'bridge'; brand: BrandKey };

/** 사이드바 표기 — 'all' 은 '법인' 으로 부른다 */
const NAV_BRANDS = BP_BRANDS.map((b) => ({
  key: b.key,
  label: b.key === 'all' ? '법인' : b.label,
}));

export default function BusinessPlan({ baseMonth }: { baseMonth: number }) {
  const [view, setView] = useState<View>({ kind: 'hub' });

  const isOn = (kind: View['kind'], brand?: BrandKey) =>
    view.kind === kind && (brand === undefined || ('brand' in view && view.brand === brand));

  const go = (next: View) => {
    setView(next);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  return (
    <div className="min-h-screen bg-[#EEF1F4]">
      {/* ── 좌측 선택 바 ── 화면에 완전히 고정 (top-14 = 고정 헤더 h-14 아래) */}
      <aside className="fixed bottom-0 left-0 top-14 z-40 w-[190px] overflow-y-auto border-r border-[#C9D2DC] bg-white">
        <div className="px-3 py-4">
          <NavItem label="첫화면" on={isOn('hub')} onClick={() => go({ kind: 'hub' })} />

          <NavGroup label="연간손익" />
          {NAV_BRANDS.map((b) => (
            <NavItem
              key={`pl-${b.key}`}
              label={b.label}
              indent
              on={isOn('pl', b.key)}
              onClick={() => go({ kind: 'pl', brand: b.key })}
            />
          ))}

          <NavGroup label="영업이익 Bridge" />
          {NAV_BRANDS.map((b) => (
            <NavItem
              key={`br-${b.key}`}
              label={b.label}
              indent
              on={isOn('bridge', b.key)}
              onClick={() => go({ kind: 'bridge', brand: b.key })}
            />
          ))}
        </div>
      </aside>

      {/* ── 본문 ── 고정 사이드바 폭만큼 확보 */}
      <div className="min-w-0 pl-[190px]">
        {view.kind === 'hub' && <BusinessPlanHub baseMonth={baseMonth} />}
        {view.kind === 'pl' && <BusinessPlanView brand={view.brand} baseMonth={baseMonth} />}
        {view.kind === 'bridge' && <BridgeView brand={view.brand} />}
      </div>
    </div>
  );
}

function NavGroup({ label }: { label: string }) {
  return (
    <div className="mt-4 border-b border-[#E5EAF0] pb-1 text-[11px] font-bold tracking-wide text-[#9C7A43]">
      {label}
    </div>
  );
}

function NavItem({
  label,
  on,
  indent,
  onClick,
}: {
  label: string;
  on: boolean;
  indent?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`mt-0.5 block w-full py-1.5 text-left text-xs ${indent ? 'pl-3' : 'font-semibold'} ${
        on
          ? 'border-l-[3px] border-[#15243B] bg-[#f2f5f9] font-semibold text-[#15243B]'
          : 'border-l-[3px] border-transparent text-[#34506F] hover:bg-[#f6f8fa]'
      }`}
    >
      {label}
    </button>
  );
}
