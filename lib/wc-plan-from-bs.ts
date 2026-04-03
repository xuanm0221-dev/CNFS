import type { TableRow } from '@/lib/types';

/** 메인 CFWorkingCapitalTable `sumComp`와 동일: 세 그룹 행의 annualPlan 합(전부 null이면 null, 아니면 null은 0). */
function sumCompAnnualPlan(rows: TableRow[], accounts: string[]): number | null {
  const vals = accounts.map((a) => rows.find((r) => r.account === a)?.comparisons?.annualPlan ?? null);
  if (vals.every((v) => v === null)) return null;
  return vals.reduce<number>((acc, v) => acc + (v ?? 0), 0);
}

function annualPlanOf(rows: TableRow[], account: string): number | null {
  const v = rows.find((r) => r.account === account)?.comparisons?.annualPlan;
  return v != null && Number.isFinite(v) ? v : null;
}

/** 그룹 행 annualPlan 우선, 없으면 지정 리프 합(리프도 전부 null이면 null). */
function groupOrLeafSumPlan(rows: TableRow[], groupAccount: string, leafAccounts: string[]): number | null {
  const g = annualPlanOf(rows, groupAccount);
  if (g != null) return g;
  const vals = leafAccounts.map((a) => annualPlanOf(rows, a));
  if (vals.every((v) => v === null)) return null;
  return vals.reduce<number>((acc, v) => acc + (v ?? 0), 0);
}

/**
 * 메인 현금흐름표 운전자본표와 동일 소스: GET /api/fs/bs?year=2026 의 workingCapital.
 * annualPlan = 파일/BS/2026.csv YYYY년연간계획(N-1) 등 readBSPlanData 파이프라인.
 * wc_total: 외상매출금·재고자산·외상매입금 그룹 행만 sumComp (CFWorkingCapitalTable computedWC).
 */
export function buildWcPlanByKeyFromBsWorkingCapital(rows: TableRow[]): Record<string, number> {
  const out: Record<string, number> = {};

  const put = (key: string, v: number | null) => {
    if (v != null && Number.isFinite(v)) out[key] = v;
  };

  put('wc_ar_direct', annualPlanOf(rows, '직영AR'));
  put('wc_ar_dealer', annualPlanOf(rows, '대리상AR'));
  put('wc_inventory_mlb', annualPlanOf(rows, 'MLB'));
  put('wc_inventory_kids', annualPlanOf(rows, 'KIDS'));
  put('wc_inventory_discovery', annualPlanOf(rows, 'DISCOVERY'));
  put('wc_ap_hq', annualPlanOf(rows, '본사AP'));
  put('wc_ap_goods', annualPlanOf(rows, '제품AP'));

  put('wc_ar', groupOrLeafSumPlan(rows, '외상매출금', ['직영AR', '대리상AR']));
  put('wc_inventory', groupOrLeafSumPlan(rows, '재고자산', ['MLB', 'KIDS', 'DISCOVERY']));
  put('wc_ap', groupOrLeafSumPlan(rows, '외상매입금', ['본사AP', '제품AP']));

  put('wc_total', sumCompAnnualPlan(rows, ['외상매출금', '재고자산', '외상매입금']));

  return out;
}
