'use client';

import { useMemo, useState } from 'react';
import InventoryTable from './InventoryTable';
import { InventoryTableData } from '@/lib/inventory-types';
import {
  MLB_REORDER_ACC_K,
  buildReorderByRowKey,
  applyReorderDealer,
  applyReorderHq,
} from '@/lib/inventory-reorder';

interface Props {
  open: boolean;
  onClose: () => void;
  brand: string;
  year: number;
  /** 본문 재고자산(sim) 이 표시 중인 데이터 (리오더 미반영) */
  dealer: InventoryTableData | null;
  hq: InventoryTableData | null;
  /** 전년(2025) 데이터 — 판매추정 카드 YoY 계산용 */
  prevDealer?: InventoryTableData | null;
  prevHq?: InventoryTableData | null;
  /** ACC 예산: 입고완료(Snowflake, M) · 발주완료(M) — 잔여예산 = ACC매입 − 입고완료 − 발주완료 */
  accArrivalM?: number;
  accArrivalThroughMonth?: number;
  accOrderM?: number;
  accOrderThroughMonth?: number;
  /** 모달 전용 대리상 성장률 (%). 본문 상태와 분리 */
  growthRate?: number;
  onGrowthRateChange?: (v: number) => void;
  /** 본문 현재 성장률 — 변경 여부 표시용 */
  baseGrowthRate?: number;
  calcLoading?: boolean;
}

// 판매추정 소표 — 본문과 동일한 열 비율
const SALE_TABLE_CLASS = 'min-w-0 w-full flex-1 table-fixed border-collapse text-xs';
const SaleColgroup = () => (
  <colgroup>
    <col style={{ width: '52%' }} />
    <col style={{ width: '48%' }} />
  </colgroup>
);

const fmtPct = (cur: number, prev: number) => (prev > 0 ? `${((cur / prev) * 100).toFixed(1)}%` : '-');
const fmtDeltaM = (v: number) => {
  const d = Math.round(v / 1000);
  return `${d >= 0 ? '+' : ''}${d.toLocaleString()}M`;
};
const fmtM = (v: number) => `${Math.round(v / 1000).toLocaleString()}M`;

function SaleCard({
  label,
  rows,
  isSummary,
}: {
  label: string;
  rows: { label: string; value: string; highlight?: boolean }[];
  isSummary?: boolean;
}) {
  const thBg = isSummary
    ? 'border border-[#2e3d5f] bg-[#1f2a44]'
    : 'border border-slate-400 bg-slate-500';
  return (
    <table className={SALE_TABLE_CLASS}>
      <SaleColgroup />
      <thead>
        <tr>
          <th className={`${thBg} px-2 py-2 text-left text-xs font-semibold text-white whitespace-nowrap`}>{label}</th>
          <th className={`${thBg} px-2 py-2 text-center text-xs font-medium text-white whitespace-nowrap`}>금액</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label} className={r.highlight ? 'bg-amber-50' : 'bg-white'}>
            <td className="border-b border-slate-200 px-2 py-1.5 align-middle font-medium text-slate-700 whitespace-nowrap">{r.label}</td>
            <td className="border-b border-slate-200 px-2 py-1.5 text-right align-middle font-semibold tabular-nums text-slate-800 whitespace-nowrap">{r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function InventoryReorderModal({
  open,
  onClose,
  brand,
  year,
  dealer,
  hq,
  prevDealer,
  prevHq,
  accArrivalM = 0,
  accArrivalThroughMonth = 0,
  accOrderM = 0,
  accOrderThroughMonth = 0,
  growthRate,
  onGrowthRateChange,
  baseGrowthRate,
  calcLoading,
}: Props) {
  const [showYoy, setShowYoy] = useState(false); // YoY 3컬럼 — 기본 숨김
  const reorderByKey = useMemo(() => buildReorderByRowKey(MLB_REORDER_ACC_K), []);

  const dealerWithReorder = useMemo(
    () => (dealer ? applyReorderDealer(dealer, reorderByKey) : null),
    [dealer, reorderByKey],
  );
  const hqWithReorder = useMemo(
    () => (hq ? applyReorderHq(hq, reorderByKey) : null),
    [hq, reorderByKey],
  );

  if (!open) return null;

  const totalReorder = reorderByKey['ACC합계'] ?? 0;

  // ── 판매추정 카드 계산 ──────────────────────────────────────────
  const dRow = (k: string) => dealerWithReorder?.rows.find((r) => r.key === k);
  const dPrev = (k: string) => prevDealer?.rows.find((r) => r.key === k);
  const hRow = (k: string) => hqWithReorder?.rows.find((r) => r.key === k);
  const hPrev = (k: string) => prevHq?.rows.find((r) => r.key === k);
  const R = (k: string) => reorderByKey[k] ?? 0;

  // 대리상: Sell-in 컬럼은 본문값 유지 → 카드의 "매입/입고"는 reorder 를 더한 실질값 사용
  const dealerCard = (key: string, labels: [string, string, string]) => {
    const cur = dRow(key);
    const prev = dPrev(key);
    if (!cur) return [
      { label: labels[0], value: '-' }, { label: labels[1], value: '-' }, { label: labels[2], value: '-' },
    ];
    const sellInEff = cur.sellInTotal + R(key);
    return [
      { label: labels[0], value: prev ? fmtPct(cur.sellOutTotal, prev.sellOutTotal) : '-' },
      { label: labels[1], value: prev ? fmtPct(sellInEff, prev.sellInTotal) : '-', highlight: R(key) > 0 },
      { label: labels[2], value: fmtDeltaM(cur.delta), highlight: R(key) > 0 },
    ];
  };

  // 본사: sellInTotal 은 이미 reorder 반영됨 / 대리상출고는 컬럼 원값 → 카드에서 reorder 더함
  const hqCombined = (row?: { sellOutTotal: number; hqSalesTotal?: number }, extra = 0) =>
    row ? row.sellOutTotal + extra + (row.hqSalesTotal ?? 0) : 0;

  const hqTotal = hRow('재고자산합계');
  const hqTotalPrev = hPrev('재고자산합계');
  const hqCloth = hRow('의류합계');
  const hqClothPrev = hPrev('의류합계');
  const hqAcc = hRow('ACC합계');
  const hqAccPrev = hPrev('ACC합계');

  const seasonSellInM = (k: string) => {
    const r = hRow(k);
    return r ? fmtM(r.sellInTotal) : '-';
  };
  const accSellInM = hqAcc ? Math.round(hqAcc.sellInTotal / 1000) : 0;
  const remainingM = accSellInM - accArrivalM - accOrderM;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4">
      <div className="my-4 w-full max-w-[1600px] rounded-2xl bg-white shadow-2xl">
        {/* 헤더 */}
        <div className="flex items-center justify-between gap-3 rounded-t-2xl border-b border-slate-200 bg-slate-50 px-5 py-3">
          <div className="flex items-baseline gap-3">
            <h2 className="text-base font-bold text-slate-900">reorder추가시</h2>
            <span className="text-sm text-slate-500">{brand} · {year}</span>
            <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
              리오더 합계 {totalReorder.toLocaleString()}K
            </span>
            {onGrowthRateChange && (
              <span className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs">
                <span className="font-semibold text-slate-700">대리상 성장률</span>
                <input
                  type="number"
                  step={1}
                  defaultValue={100 + (growthRate ?? 0)}
                  key={growthRate}
                  onBlur={(e) => {
                    const raw = Number(e.target.value);
                    if (Number.isFinite(raw)) onGrowthRateChange(raw - 100);
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                  className="w-16 rounded border border-slate-300 px-1.5 py-0.5 text-right tabular-nums outline-none focus:border-sky-400"
                />
                <span className="text-slate-500">%</span>
                {baseGrowthRate != null && growthRate !== baseGrowthRate && (
                  <span className="text-[11px] text-sky-600">(본문 {100 + baseGrowthRate}%)</span>
                )}
                {calcLoading && <span className="text-[11px] text-slate-400">계산 중…</span>}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowYoy((v) => !v)}
            className={`rounded-lg border px-3 py-1.5 text-xs shadow-sm hover:bg-slate-50 ${showYoy ? 'border-sky-400 bg-sky-50 text-sky-700' : 'border-slate-300 bg-white text-slate-600'}`}
            title="Sell-in / Sell-out / 기말 YoY 컬럼 표시"
          >
            YoY 컬럼 {showYoy ? '숨기기' : '보기'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-600 shadow-sm hover:bg-slate-50"
          >
            닫기 ✕
          </button>
          </div>
        </div>

        <div className="px-5 py-4">
          {/* 리오더 물량 안내 */}
          <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <span className="font-semibold">리오더 물량 (CNY K)</span>
            {Object.entries(MLB_REORDER_ACC_K).map(([k, v]) => (
              <span key={k}>
                {k} <span className="font-semibold tabular-nums">{v.toLocaleString()}</span>
              </span>
            ))}
          </div>

          {/* 판매추정 카드 — 리오더 반영 */}
          <div className="mb-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
            {/* 대리상 판매추정 */}
            <div className="min-w-0">
              <div className="mb-2 text-sm font-semibold text-slate-800">{brand} 대리상 판매추정</div>
              <div className="flex gap-2">
                <SaleCard isSummary label="합계" rows={dealerCard('재고자산합계', ['리테일(연간)', '매입합계', '재고증감'])} />
                <div className="flex min-w-0 flex-[2] gap-0">
                  <SaleCard label="의류" rows={dealerCard('의류합계', ['의류판매', 'OTB', '의류재고'])} />
                  <SaleCard label="ACC" rows={dealerCard('ACC합계', ['ACC판매', 'ACC입고', 'ACC재고'])} />
                </div>
              </div>
              <div className="mt-1.5 flex items-center gap-2 text-[11px] text-slate-600">
                <span className="font-semibold text-slate-700">OTB:</span>
                <span>당년F <span className="font-semibold tabular-nums text-slate-800">
                  {dRow('당년F') && dPrev('당년F') ? fmtPct(dRow('당년F')!.sellInTotal, dPrev('당년F')!.sellInTotal) : '-'}
                </span></span>
                <span className="text-slate-300">|</span>
                <span>당년S <span className="font-semibold tabular-nums text-slate-800">
                  {dRow('당년S') && dPrev('당년S') ? fmtPct(dRow('당년S')!.sellInTotal, dPrev('당년S')!.sellInTotal) : '-'}
                </span></span>
                <span className="text-slate-400">(당년S 전년 Sell-in 미포함)</span>
              </div>
            </div>

            {/* 직영 판매추정 */}
            <div className="min-w-0">
              <div className="mb-2 text-sm font-semibold text-slate-800">{brand} 직영 판매추정</div>
              <div className="flex gap-2">
                <SaleCard
                  isSummary
                  label="합계"
                  rows={[
                    { label: '대리상출고', value: hqTotal && hqTotalPrev ? fmtPct(hqTotal.sellOutTotal + R('재고자산합계'), hqTotalPrev.sellOutTotal) : '-', highlight: true },
                    { label: '직영판매', value: hqTotal && hqTotalPrev && (hqTotalPrev.hqSalesTotal ?? 0) > 0 ? fmtPct(hqTotal.hqSalesTotal ?? 0, hqTotalPrev.hqSalesTotal ?? 1) : '-' },
                    { label: '출고합계 YOY', value: hqTotal && hqTotalPrev ? fmtPct(hqCombined(hqTotal, R('재고자산합계')), hqCombined(hqTotalPrev)) : '-', highlight: true },
                    { label: '재고증감', value: hqTotal && hqTotalPrev ? fmtDeltaM(hqTotal.closing - hqTotalPrev.closing) : '-' },
                    { label: '상품매입', value: hqTotal ? fmtM(hqTotal.sellInTotal) : '-', highlight: true },
                  ]}
                />
                <div className="flex min-w-0 flex-[2] gap-0">
                  <SaleCard
                    label="의류"
                    rows={[
                      { label: '의류판매', value: hqCloth && hqClothPrev ? fmtPct(hqCombined(hqCloth), hqCombined(hqClothPrev)) : '-' },
                      { label: '의류재고', value: hqCloth ? fmtDeltaM(hqCloth.delta) : '-' },
                      { label: '의류매입', value: hqCloth ? fmtM(hqCloth.sellInTotal) : '-' },
                      { label: '26SS', value: seasonSellInM('당년S') },
                      { label: '26FW', value: seasonSellInM('당년F') },
                      { label: '27SS', value: seasonSellInM('차기시즌') },
                    ]}
                  />
                  <SaleCard
                    label="ACC"
                    rows={[
                      { label: 'ACC판매', value: hqAcc && hqAccPrev ? fmtPct(hqCombined(hqAcc, R('ACC합계')), hqCombined(hqAccPrev)) : '-', highlight: true },
                      { label: 'ACC재고', value: hqAcc ? fmtDeltaM(hqAcc.delta) : '-' },
                      { label: 'ACC매입', value: hqAcc ? fmtM(hqAcc.sellInTotal) : '-', highlight: true },
                      { label: `입고완료(${accArrivalThroughMonth}월)`, value: `${accArrivalM.toLocaleString()}M` },
                      { label: `발주완료(${accOrderThroughMonth}월)`, value: `${accOrderM.toLocaleString()}M` },
                      { label: '잔여예산', value: `${remainingM.toLocaleString()}M`, highlight: true },
                    ]}
                  />
                </div>
              </div>
            </div>
          </div>
          {/* 대리상 | 본사 좌우 배치 */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <div className="min-w-0">
              <div className="mb-2 text-sm font-semibold text-slate-800">
                {brand} 대리상 (CNY K)
                <span className="ml-2 text-xs font-normal text-slate-500">
                  기말 = 기초 + Sell-in + reorder − Sell-out
                </span>
              </div>
              {dealerWithReorder ? (
                <InventoryTable
                  title={`${brand} 대리상 (CNY K)`}
                  data={dealerWithReorder}
                  year={year}
                  showLegend={false}
                  sellInLabel="Sell-in"
                  sellOutLabel="Sell-out"
                  tableType="dealer"
                  reorderByKey={reorderByKey}
                  accSubtotalShowsWoi
                  prevYearData={prevDealer ?? null}
                  prevYearTotalSellIn={prevDealer?.rows.find((r) => r.key === '재고자산합계')?.sellInTotal}
                  prevYearTotalSellOut={prevDealer?.rows.find((r) => r.key === '재고자산합계')?.sellOutTotal}
                  showYoyColumns={showYoy}
                />
              ) : (
                <div className="py-8 text-center text-xs text-slate-400">데이터 로딩 중…</div>
              )}
            </div>

            <div className="min-w-0">
              <div className="mb-2 text-sm font-semibold text-slate-800">
                {brand} 본사 (CNY K)
                <span className="ml-2 text-xs font-normal text-slate-500">
                  대리상출고 +reorder → 상품매입도 +reorder → 기말 불변
                </span>
              </div>
              {hqWithReorder ? (
                <InventoryTable
                  title={`${brand} 본사 (CNY K)`}
                  data={hqWithReorder}
                  year={year}
                  showLegend={false}
                  sellInLabel="상품매입"
                  sellOutLabel="대리상출고"
                  tableType="hq"
                  reorderByKey={reorderByKey}
                  accSubtotalShowsWoi
                  prevYearData={prevHq ?? null}
                  prevYearTotalSellIn={prevHq?.rows.find((r) => r.key === '재고자산합계')?.sellInTotal}
                  prevYearTotalSellOut={prevHq?.rows.find((r) => r.key === '재고자산합계')?.sellOutTotal}
                  prevYearTotalHqSales={prevHq?.rows.find((r) => r.key === '재고자산합계')?.hqSalesTotal}
                  showYoyColumns={showYoy}
                />
              ) : (
                <div className="py-8 text-center text-xs text-slate-400">데이터 로딩 중…</div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
