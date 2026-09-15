'use client';

// 대리상 ACC 재고주수 비교 모달 (MLB 전용)
// 본문 재고자산(sim) 대리상 표의 ACC합계 재고주수 셀을 클릭하면 열린다.
//   (1) 목표          : 본문 표 그대로 (대리상 목표 재고주수 역산, 리테일 = 본문 성장률)
//   (2) 목표+리오더   : "reorder추가시" 모달과 동일 — 리오더 성장률(기본 105%, 본문과 동일)로 표를 다시 역산한 뒤 리오더 물량 가산
//   (3) 현지 ACC출고계획: 대리상매입을 손익(PL) Tag매출_대리상_ACC 연간으로 두고, 리테일은 (1) 그대로
//                         → 기말 = (1)기말 + (PL출고 − (1)매입), 재고주수 = 기말 ÷ 주간 리테일
// 재고주수 공식·연일수(366)는 본문·리오더 모달과 같은 값을 쓴다. 아이템별 PL 출고계획은 없어 (3)은 ACC합계만.
import { InventoryRow, InventoryTableData, ACC_KEYS, AccKey } from '@/lib/inventory-types';
import { calcWoi, formatWoi } from '@/lib/inventory-calc';
import { REORDER_YEAR_DAYS } from '@/lib/inventory-reorder';

interface Props {
  open: boolean;
  onClose: () => void;
  year: number;
  /** (1) 본문 대리상 표 (표시 데이터) */
  baseDealer: InventoryTableData | null;
  /** (2) 리오더 성장률로 재역산 + 리오더 반영된 대리상 표. 계산 전이면 null */
  reorderDealer: InventoryTableData | null;
  /** 행 키별 리오더 물량 (CNY K) */
  reorderByKey: Record<string, number>;
  /** (3) PL Tag매출_대리상_ACC 연간 (CNY K). 조회 전이면 null */
  plAccSellInK: number | null;
  /** 헤더 표기용 9~12월 성장률 (%) — 본문 / 리오더 / PL 리테일 대리상 */
  baseGrowthPct: number;
  reorderGrowthPct: number;
  plRetailGrowthPct: number | null;
  /** "9~12월" 라벨용 기준월 */
  baseMonth: number;
  calcLoading?: boolean;
}

const ROW_KEYS: string[] = ['ACC합계', ...ACC_KEYS];

const fmtK = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '' : Math.round(v).toLocaleString('en-US');
const fmtGrowth = (pct: number | null) => (pct == null ? '' : `(${Math.round(100 + pct)}%)`);

function byKey(data: InventoryTableData | null): Record<string, InventoryRow> {
  if (!data) return {};
  return Object.fromEntries(data.rows.map((r) => [r.key, r]));
}

export default function InventoryAccWoiModal({
  open,
  onClose,
  year,
  baseDealer,
  reorderDealer,
  reorderByKey,
  plAccSellInK,
  baseGrowthPct,
  reorderGrowthPct,
  plRetailGrowthPct,
  baseMonth,
  calcLoading,
}: Props) {
  if (!open) return null;

  const base = byKey(baseDealer);
  const re = byKey(reorderDealer);
  const acc = base['ACC합계'];

  // (3) 현지 ACC출고계획 — ACC합계만
  const plClosing = acc && plAccSellInK != null ? acc.closing + (plAccSellInK - acc.sellInTotal) : null;
  const plWoi = acc && plClosing != null ? calcWoi(plClosing, acc.sellOutTotal, REORDER_YEAR_DAYS) : null;

  // 아직 안 온 열은 빈칸 대신 "계산 중…" 을 셀 안에 보여준다 (빈칸으로 오해하지 않게)
  const reorderPending = reorderDealer == null;
  const plPending = plAccSellInK == null;
  const anyPending = reorderPending || plPending;
  const Pending = () => (
    <span className="inline-flex items-center gap-1 text-xs font-normal not-italic text-amber-600">
      <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
      계산 중…
    </span>
  );

  const monthLabel = `${baseMonth + 1}~12월 성장율`;
  const th = 'border border-slate-400 bg-slate-600 px-3 py-2 text-center text-xs font-semibold text-white';
  const thSub = 'block text-[11px] font-normal text-slate-200';
  const tdLabel = 'border border-slate-300 px-3 py-1.5 text-left text-sm whitespace-nowrap';
  const tdNum = 'border border-slate-300 px-3 py-1.5 text-right text-sm tabular-nums whitespace-nowrap';
  const reorderBg = 'bg-slate-50 text-xs font-normal not-italic text-slate-500';

  const rowCls = (key: string) => (key === 'ACC합계' ? 'bg-highlight-sky font-semibold text-slate-900' : 'bg-white italic text-slate-700');
  const footRowCls = 'bg-highlight-sky font-semibold text-slate-900';
  const labelOf = (key: string) => (key === 'ACC합계' ? 'ACC합계' : `  ${key}`);

  // 위·아래 표 열 폭 동일 (첫 열 라벨 길이에 따라 달라지지 않게 table-fixed + 공용 colgroup)
  const Cols = () => (
    <colgroup>
      <col style={{ width: '26%' }} />
      <col style={{ width: '17%' }} />
      <col style={{ width: '13%' }} />
      <col style={{ width: '20%' }} />
      <col style={{ width: '24%' }} />
    </colgroup>
  );
  const Head = ({ first }: { first: string }) => (
    <thead>
      <tr>
        <th className={`${th} text-left`}>
          {first}
          <span className={thSub}>{monthLabel}</span>
        </th>
        <th className={th}>
          목표
          <span className={thSub}>{fmtGrowth(baseGrowthPct)}</span>
        </th>
        <th className="border border-slate-300 bg-slate-100 px-3 py-2 text-center text-xs font-normal text-slate-500">리오더</th>
        <th className={th}>
          목표+리오더
          <span className={thSub}>{fmtGrowth(reorderGrowthPct)}</span>
        </th>
        <th className={th}>
          현지 ACC출고계획
          <span className={thSub}>{fmtGrowth(plRetailGrowthPct)}</span>
        </th>
      </tr>
    </thead>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4" onClick={onClose}>
      <div className="my-8 w-full max-w-[880px] rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* 헤더 */}
        <div className="flex items-center justify-between gap-3 rounded-t-2xl border-b border-slate-200 bg-slate-50 px-5 py-3">
          <div className="flex items-baseline gap-3">
            <h2 className="text-base font-bold text-slate-900">대리상 ACC 재고주수 비교</h2>
            <span className="text-sm text-slate-500">MLB · {year}</span>
            {(calcLoading || anyPending) && (
              <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
                계산 중…
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600 shadow-sm hover:bg-slate-50"
          >
            닫기
          </button>
        </div>

        <div className="space-y-6 px-5 py-5">
          {anyPending && (
            <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
              <span>
                {reorderPending && '목표+리오더 (리테일 재조회 후 재역산)'}
                {reorderPending && plPending && ' · '}
                {plPending && '현지 ACC출고계획 (손익계산서 조회)'}
                {' '}계산 중입니다 — 잠시 후 채워집니다.
              </span>
            </div>
          )}
          {/* ① 재고주수 */}
          <table className="w-full table-fixed border-collapse">
            <Cols />
            <Head first="재고주수" />
            <tbody>
              {ROW_KEYS.map((key) => {
                const b = base[key];
                const r = re[key];
                const isTotal = key === 'ACC합계';
                return (
                  <tr key={`woi-${key}`} className={rowCls(key)}>
                    <td className={tdLabel}>{labelOf(key)}</td>
                    <td className={tdNum}>{b ? formatWoi(b.woi) : ''}</td>
                    <td className={`${tdNum} ${reorderBg}`} />
                    <td className={tdNum}>{r ? formatWoi(r.woi) : reorderPending ? <Pending /> : ''}</td>
                    <td className={tdNum}>{isTotal ? (plWoi != null ? formatWoi(plWoi) : plPending ? <Pending /> : '') : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* ② 보조표 — 매입 · 기말 · 리테일 */}
          <table className="w-full table-fixed border-collapse">
            <Cols />
            <Head first="대리상매입/본사출고" />
            <tbody>
              {ROW_KEYS.map((key) => {
                const b = base[key];
                const r = re[key];
                const ro = reorderByKey[key] ?? 0;
                const isTotal = key === 'ACC합계';
                return (
                  <tr key={`si-${key}`} className={rowCls(key)}>
                    <td className={tdLabel}>{labelOf(key)}</td>
                    <td className={tdNum}>{fmtK(b?.sellInTotal)}</td>
                    <td className={`${tdNum} ${reorderBg} text-xs`}>{ro ? fmtK(ro) : ''}</td>
                    {/* 리오더 모달과 동일: 리오더 성장률로 재역산한 매입 + 리오더 */}
                    <td className={tdNum}>{r ? fmtK(r.sellInTotal + ro) : reorderPending ? <Pending /> : ''}</td>
                    <td className={tdNum}>{isTotal ? (plPending ? <Pending /> : fmtK(plAccSellInK)) : ''}</td>
                  </tr>
                );
              })}
              <tr className={footRowCls}>
                <td className={tdLabel}>재고자산</td>
                <td className={tdNum}>{fmtK(acc?.closing)}</td>
                <td className={`${tdNum} ${reorderBg}`} />
                <td className={tdNum}>{reorderPending ? <Pending /> : fmtK(re['ACC합계']?.closing)}</td>
                <td className={tdNum}>{plPending ? <Pending /> : fmtK(plClosing)}</td>
              </tr>
              <tr className={footRowCls}>
                <td className={tdLabel}>리테일</td>
                <td className={tdNum}>{fmtK(acc?.sellOutTotal)}</td>
                <td className={`${tdNum} ${reorderBg}`} />
                <td className={tdNum}>{reorderPending ? <Pending /> : fmtK(re['ACC합계']?.sellOutTotal)}</td>
                <td className={tdNum}>{fmtK(acc?.sellOutTotal)}</td>
              </tr>
            </tbody>
          </table>

          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <div>재고주수 = 기말 ÷ (연간 리테일 ÷ {REORDER_YEAR_DAYS}일 × 7) — 본문·리오더 모달과 같은 공식</div>
            <div>목표+리오더 = 리오더 성장률로 표를 다시 역산한 매입에 리오더 물량을 더한 것 (reorder추가시 모달과 동일)</div>
            <div>현지 ACC출고계획 = 손익계산서 Tag매출 대리상 ACC 연간. 기말 = 목표 기말 + (출고계획 − 목표 매입), 리테일은 목표와 동일. 아이템별 계획은 없어 ACC합계만</div>
          </div>
        </div>
      </div>
    </div>
  );
}
