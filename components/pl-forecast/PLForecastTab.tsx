'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { formatNumber } from '@/lib/utils';
import type { CFHierarchyApiRow } from '@/app/api/fs/cf-hierarchy/route';
import {
  ANNUAL_2025_RAW_BY_BRAND,
  DIRECT_EXPENSE_ACCOUNTS,
  FORECAST_BRANDS,
  MONTH_HEADERS,
  OPERATING_EXPENSE_ACCOUNTS,
  RAW_ACCOUNTS,
  ROWS_BRAND,
  ROWS_CORPORATE,
  FINANCIAL_ADJUST_ACCOUNTS,
  SCENARIO_DEFS,
  SCENARIO_ORDER,
  computeEffectiveGrowthRates,
  type ForecastLeafBrand,
  type ForecastRowDef,
  type SalesBrand,
  type ScenarioDef,
  type ScenarioKey,
  type ScenarioInventoryPayload,
} from './plForecastConfig';

type MonthlyInputs = Record<ForecastLeafBrand, Record<string, (number | null)[]>>;

type CalculatedSeries = {
  monthly: Record<string, (number | null)[]>;
  annual2025: Record<string, number | null>;
};

type SalesSeason = '당년S' | '당년F' | '1년차' | '차기시즌';
type SalesLeafKind = 'dealerCurrS' | 'dealerCurrF' | 'dealerYear1' | 'dealerNext' | 'dealerAcc' | 'direct';

interface SalesRowDef {
  id: string;
  parentId: string | null;
  level: number;
  brand: SalesBrand;
  channelLabel: string;
  accountLabel: string;
  isGroup: boolean;
  leafKind?: SalesLeafKind;
}

const SALES_BRANDS: SalesBrand[] = ['MLB', 'MLB KIDS', 'DISCOVERY'];
const DEALER_CLOTH_SEASONS: SalesSeason[] = ['당년S', '당년F', '1년차', '차기시즌'];
const FIXED_COST_ACCOUNTS = new Set(['기타(직접비)', '대리상지원금', '감가상각비']);

// ScenarioKey, ScenarioDef, SCENARIO_DEFS, SCENARIO_ORDER → plForecastConfig.ts 에서 import

type ScenarioWcInvBrand = { tagK: number; costRatio: number; valRate: number; costK: number };
type ScenarioWcRow = {
  ar: number | null;
  inventory: number | null;
  inventoryByBrand?: Record<SalesBrand, ScenarioWcInvBrand>;
  ap: number | null;
  total: number | null;
};

type ScenarioBrandCalc = {
  tagSalesMonthly: (number | null)[];
  salesChannel: {
    dealerCloth: (number | null)[];
    dealerAcc: (number | null)[];
    dealer: (number | null)[];
    direct: (number | null)[];
  };
  salesActual: {
    dealerCloth: (number | null)[];
    dealerAcc: (number | null)[];
    dealer: (number | null)[];
    direct: (number | null)[];
    total: (number | null)[];
  };
  retail: {
    dealer: (number | null)[];
    direct: (number | null)[];
    total: (number | null)[];
  };
  calculated: CalculatedSeries;
};

type ScenarioResult = {
  byBrand: Record<ForecastLeafBrand, ScenarioBrandCalc>;
  corporate: ScenarioBrandCalc;
};

type AllScenarioData = Record<ScenarioKey, ScenarioResult>;
// ─────────────────────────────────────────────────────────────────────────────

const FORECAST_TO_SALES_BRAND: Record<ForecastLeafBrand, SalesBrand> = {
  mlb: 'MLB',
  kids: 'MLB KIDS',
  discovery: 'DISCOVERY',
};
const INVENTORY_GROWTH_PARAMS_KEY = 'inventory_growth_params';
const PL_TAG_COST_RATIO_KEY = 'pl_tag_cost_ratio_annual';
/** 시나리오 모달 「현금 & 차입금」표 기초잔액 (K CNY, 원 ÷ 1000 반올림) */
const SCENARIO_CASH_DEBT_OPENING_K = { cash: 139543, debt: 909685 } as const;
/** 시나리오 표: 연간↔YOY, YOY↔기존계획대비 사이 세로선(얇게) */
const SCENARIO_COL_DIVIDER_THIN_R = '[border-right:1px_dashed_#cbd5e1]';
/** 시나리오 블록 끝(다음 시나리오 열 앞) — 1px 유지 */
const SCENARIO_COL_DIVIDER_BLK_R = 'border-r border-r-slate-200';
/** CF 비용 하위: 시뮬 전용 조정 행(CSV 기존계획 0, 부정·긍정 열에 차액만) */
const SCENARIO_CF_POS_NEG_ADJUST_ACCOUNT = '부정/긍정 조정';
const SCENARIO_CF_TAX_ADJUST_ACCOUNT = '법인세 조정';
const SCENARIO_CF_CORP_TAX_RATE = 0.25;

const ACCOUNT_LABEL_OVERRIDES: Record<string, string> = {
  Tag매출_대리상: '대리상',
  Tag매출_의류: '의류',
  Tag매출_ACC: 'ACC',
  Tag매출_직영: '직영',
  실판매출: '실판매출(V-)',
  실판매출_대리상: '대리상',
  실판매출_의류: '의류',
  실판매출_ACC: 'ACC',
  실판매출_직영: '직영',
};

function formatScenarioCfAmount(value: number): string {
  if (value === 0) return '-';
  return value < 0
    ? `(${formatNumber(Math.abs(value), false, false)})`
    : formatNumber(value, false, false);
}

/** 전년대비: 옆 열(2025 실적·기존계획)과 동일하게 K(원 ÷ 1000, 정수) */
function formatScenarioCfYoyDiff(당년: number | null, 전년: number | null): string {
  if (당년 == null || 전년 == null) return '-';
  if (!Number.isFinite(당년) || !Number.isFinite(전년)) return '-';
  const diffK = Math.round((당년 - 전년) / 1000);
  if (diffK === 0) return '0';
  const body = Math.abs(diffK).toLocaleString('ko-KR');
  if (diffK > 0) return `+${body}`;
  return `-${body}`;
}

/** 기존계획대비(부정·긍정): 시나리오 원 − 기존계획(연간) 원 → K 정수, 전년대비와 동일 부호 규칙 */
function formatScenarioCfVsBase(시나리오원: number | null, 기존계획원: number | null): string {
  if (시나리오원 == null || 기존계획원 == null) return '-';
  if (!Number.isFinite(시나리오원) || !Number.isFinite(기존계획원)) return '-';
  return formatScenarioCfYoyDiff(시나리오원, 기존계획원);
}

/** 시나리오 PL 연동 없음 → 부정·긍정 열에도 기존계획(연간)과 동일 금액 표시 */
function scenarioCfRowMirrorsBasePlan(row: CFHierarchyApiRow): boolean {
  if (row.account === 'net cash') return false;
  if (row.account === '기타수익' || row.account === '차입금') return true;
  if (row.account === '자산성지출' && row.level === 0 && row.isGroup) return true;
  if (row.대분류 === '자산성지출' && row.level === 1) return true;
  if (row.대분류 === '영업활동' && row.account === '본사선급금') return true;
  if (row.대분류 === '영업활동' && row.account === '비용' && row.isGroup && row.level === 1) return true;
  if (row.대분류 === '영업활동' && row.중분류 === '비용' && row.level === 2) {
    if (row.account === SCENARIO_CF_POS_NEG_ADJUST_ACCOUNT) return false;
    if (row.account === SCENARIO_CF_TAX_ADJUST_ACCOUNT) return false;
    return true;
  }
  return false;
}

/**
 * 부정·긍정 CF 연간(values[13], 원): 매출수금은 PL 실판매출(V-) ΔK 가산, 물품대는 PL 매출원가 ΔK 감산(CF 유출 부호와 맞춤).
 */
function cfWcLinkedPlanYuan(
  row: CFHierarchyApiRow,
  scKey: ScenarioKey,
  plan26: number | null,
  scenarioData: AllScenarioData | null,
): number | null {
  if (scKey === 'base' || plan26 == null || !Number.isFinite(plan26)) return null;
  if (row.대분류 !== '영업활동' || !row.isGroup || row.level !== 1) return null;
  if (row.account === '매출수금') {
    const plK = corpRealSalesVsBaseDeltaK(scKey, scenarioData);
    if (plK == null) return null;
    return plan26 + plK * 1000;
  }
  if (row.account === '물품대') {
    const cogsK = corpCogsVsBaseDeltaK(scKey, scenarioData);
    if (cogsK == null) return null;
    return plan26 - cogsK * 1000;
  }
  return null;
}

function cfPlan26Yuan(r: CFHierarchyApiRow): number | null {
  const v = r.values ?? [];
  return Number.isFinite(v[13]) ? v[13] : null;
}

/**
 * 부정·긍정 영업활동 합계(원) = 표와 동일 규칙으로 네 그룹 행만 합산
 * (매출수금·물품대 PL연동, 본사선급금·비용 그룹 기존계획 연간, 시뮬 「부정/긍정 조정」「법인세 조정」차액 가산)
 */
function cfOperatingActivityScenarioYuan(
  rows: CFHierarchyApiRow[] | null,
  scKey: ScenarioKey,
  scenarioData: AllScenarioData | null,
): number | null {
  if (!rows?.length || scKey === 'base') return null;
  const rSales = rows.find(
    (r) => r.대분류 === '영업활동' && r.account === '매출수금' && r.isGroup && r.level === 1,
  );
  const rGoods = rows.find(
    (r) => r.대분류 === '영업활동' && r.account === '물품대' && r.isGroup && r.level === 1,
  );
  const rAdv = rows.find(
    (r) => r.대분류 === '영업활동' && r.account === '본사선급금' && !r.isGroup && r.level === 1,
  );
  const rExp = rows.find(
    (r) => r.대분류 === '영업활동' && r.account === '비용' && r.isGroup && r.level === 1,
  );
  if (!rSales || !rGoods || !rAdv || !rExp) return null;
  const pS = cfPlan26Yuan(rSales);
  const pG = cfPlan26Yuan(rGoods);
  const pA = cfPlan26Yuan(rAdv);
  const pE = cfPlan26Yuan(rExp);
  if (pS == null || pG == null || pA == null || pE == null) return null;
  const adjS = cfWcLinkedPlanYuan(rSales, scKey, pS, scenarioData);
  const adjG = cfWcLinkedPlanYuan(rGoods, scKey, pG, scenarioData);
  if (adjS == null || adjG == null) return null;
  const adjPn = cfSimPosNegAdjustYuan(scKey, scenarioData);
  const adjTax = cfSimCorpTaxAdjustYuan(scKey, scenarioData);
  if (adjPn == null || adjTax == null) return null;
  return adjS + adjG + pA + pE + adjPn + adjTax;
}

/**
 * 부정·긍정 차입금 연간(원): 기존계획 차입 − (△영업활동 + △자산성지출 + △기타수익).
 * △ = 해당 대분류 연간(시나리오 − 기존계획). 자산성·기타는 기존계획 미러이므로 Δ=0.
 * 차입금이 음수(갚은 것)이므로 영업 악화(△ < 0) → 덜 갚음(차입이 덜 음수).
 */
function cfBorrowScenarioFlowYuan(
  rows: CFHierarchyApiRow[] | null,
  scKey: ScenarioKey,
  scenarioData: AllScenarioData | null,
): number | null {
  if (!rows?.length || scKey === 'base') return null;
  const rOp = rows.find((r) => r.level === 0 && r.account === '영업활동' && r.isGroup);
  const rCap = rows.find((r) => r.account === '자산성지출' && r.level === 0 && r.isGroup);
  const rOth = rows.find((r) => r.account === '기타수익' && r.level === 0);
  const rBorrow = rows.find((r) => r.account === '차입금' && r.level === 0);
  if (!rOp || !rCap || !rOth || !rBorrow) return null;
  const opPl = cfPlan26Yuan(rOp);
  const cPl = cfPlan26Yuan(rCap);
  const oPl = cfPlan26Yuan(rOth);
  const pB = cfPlan26Yuan(rBorrow);
  if (opPl == null || cPl == null || oPl == null || pB == null) return null;
  const opSc = cfOperatingActivityScenarioYuan(rows, scKey, scenarioData);
  if (opSc == null) return null;
  const cSc = cPl;
  const oSc = oPl;
  return pB - (opSc - opPl) - (cSc - cPl) - (oSc - oPl);
}

/**
 * 부정·긍정 net cash 연간(원): 영업활동 + 자산성지출 + 기타수익 + 차입금 (4개 항목 합산).
 */
function cfNetCashScenarioYuan(
  rows: CFHierarchyApiRow[] | null,
  scKey: ScenarioKey,
  scenarioData: AllScenarioData | null,
): number | null {
  if (!rows?.length || scKey === 'base') return null;
  const rCap = rows.find((r) => r.account === '자산성지출' && r.level === 0 && r.isGroup);
  const rOth = rows.find((r) => r.account === '기타수익' && r.level === 0);
  if (!rCap || !rOth) return null;
  const cPl = cfPlan26Yuan(rCap);
  const oPl = cfPlan26Yuan(rOth);
  if (cPl == null || oPl == null) return null;
  const opSc = cfOperatingActivityScenarioYuan(rows, scKey, scenarioData);
  const borrowSc = cfBorrowScenarioFlowYuan(rows, scKey, scenarioData);
  if (opSc == null || borrowSc == null) return null;
  // 자산성·기타는 기존계획 미러
  return opSc + cPl + oPl + borrowSc;
}

/**
 * 시나리오 모달 「현금 & 차입금」기말(K): 위 현금흐름표와 동일 헬퍼로 연간(원) 차이 → 반올림 K.
 * 기말차입K = 기존계획 기말차입K + round((차입_sc − 차입_pl) / 1000)
 *   (차입_sc > 차입_pl 이면 덜 갚은 것 → 잔액 증가)
 *   단, 차입금 잔액은 0 하한 적용: 초과 상환분은 기말현금으로 이전.
 * 기말현금K = 기존계획 기말현금K + round((net_sc − net_pl) / 1000) + 초과상환잉여K
 */
function cfScenarioCbdClosingPairK(
  rows: CFHierarchyApiRow[] | null,
  scKey: ScenarioKey,
  scenarioData: AllScenarioData | null,
  cashPlanK: number | null,
  debtPlanK: number | null,
  ncPlYuan: number | null,
  borrowPlYuan: number | null,
): { cash: number; debt: number } | null {
  if (
    rows == null ||
    scKey === 'base' ||
    cashPlanK == null ||
    debtPlanK == null ||
    ncPlYuan == null ||
    borrowPlYuan == null
  ) {
    return null;
  }
  if (
    !Number.isFinite(cashPlanK) ||
    !Number.isFinite(debtPlanK) ||
    !Number.isFinite(ncPlYuan) ||
    !Number.isFinite(borrowPlYuan)
  ) {
    return null;
  }
  const ncSc = cfNetCashScenarioYuan(rows, scKey, scenarioData);
  const borrowSc = cfBorrowScenarioFlowYuan(rows, scKey, scenarioData);
  if (ncSc == null || borrowSc == null) return null;
  const rawDebtK = debtPlanK + Math.round((borrowSc - borrowPlYuan) / 1000);
  // 차입금 잔액 0 하한: 창출 현금이 잔액보다 크면 초과분은 기말현금으로 이전
  const debtK = Math.max(0, rawDebtK);
  const surplusK = Math.max(0, -rawDebtK);
  const cashK = cashPlanK + Math.round((ncSc - ncPlYuan) / 1000) + surplusK;
  return { cash: cashK, debt: debtK };
}

/** PL 시나리오 모달: 해당 시나리오 연간 − 기존계획 연간. number는 K(원÷1000), percent는 YOY와 동일 %p */
function fmtVsBasePl(시나리오원: number | null, 기존계획원: number | null, fmt?: 'number' | 'percent'): string {
  if (fmt === 'percent') {
    if (시나리오원 === null || 기존계획원 === null) return '-';
    const diff = (시나리오원 - 기존계획원) * 100;
    return `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%p`;
  }
  return formatScenarioCfYoyDiff(시나리오원, 기존계획원);
}

interface InventoryGrowthParams {
  growthRate: number;
  growthRateHq: number;
  growthRateByBrand: Record<SalesBrand, number>;
  growthRateHqByBrand: Record<SalesBrand, number>;
}

interface RetailRow {
  isTotal: boolean;
  monthly: (number | null)[];
}

interface RetailSalesApiResponse {
  dealer?: { rows?: RetailRow[] };
  hq?: { rows?: RetailRow[] };
  retail2025?: { dealer?: { rows?: RetailRow[] }; hq?: { rows?: RetailRow[] } };
}

interface ShipmentProgressRow {
  brand: SalesBrand;
  season: SalesSeason;
  prevYearProgress: number | null;
  monthly: (number | null)[];
}

interface AccShipmentRatioRow {
  brand: SalesBrand;
  monthly: (number | null)[];
}

interface BrandActualData {
  tag: { dealer: (number | null)[]; direct: (number | null)[]; dealerCloth: (number | null)[]; dealerAcc: (number | null)[] };
  sales: { dealer: (number | null)[]; direct: (number | null)[]; dealerCloth: (number | null)[]; dealerAcc: (number | null)[] };
  retail: { dealer: (number | null)[]; direct: (number | null)[] };
  accounts: Record<string, (number | null)[]>;
}

interface BrandActualApiResponse {
  brands: Record<SalesBrand, BrandActualData>;
  availableMonths: number[];
  error?: string;
}

type SalesSupportActualKey = SalesSeason | 'ACC';

interface SalesSupportActualApiResponse {
  brands: Record<SalesBrand, Record<SalesSupportActualKey, (number | null)[]>>;
  availableMonths: number[];
  error?: string;
}

interface OpexForecastApiResponse {
  brands: Record<SalesBrand, Record<string, (number | null)[]>>;
  error?: string;
}

interface DirectExpenseRatioApiResponse {
  brands: Record<SalesBrand, Record<string, (number | null)[]>>;
  error?: string;
}

interface TagCostRatioApiResponse {
  brands: Record<SalesBrand, (number | null)[]>;
  error?: string;
}

const INVENTORY_DEALER_ACC_SELLIN_KEY = 'inventory_dealer_acc_sellin';

interface DealerAccSellInPayload {
  values?: Partial<Record<SalesBrand, number>>;
}

type ShipmentRateChannel = 'dealerCloth' | 'dealerAcc' | 'direct';
const SHIPMENT_RATE_PERCENT_BY_CHANNEL: Record<ShipmentRateChannel, Record<SalesBrand, number>> = {
  dealerCloth: { MLB: 42, 'MLB KIDS': 42, DISCOVERY: 45 },
  dealerAcc: { MLB: 47, 'MLB KIDS': 42, DISCOVERY: 45 },
  direct: { MLB: 90, 'MLB KIDS': 90, DISCOVERY: 90 },
};

const BRAND_SHIPMENT_RATE_ROWS: Array<{ category: '대리상(의류)' | '대리상(ACC)' | '직영'; rates: Record<SalesBrand, number> }> = [
  { category: '대리상(의류)', rates: SHIPMENT_RATE_PERCENT_BY_CHANNEL.dealerCloth },
  { category: '대리상(ACC)', rates: SHIPMENT_RATE_PERCENT_BY_CHANNEL.dealerAcc },
  { category: '직영', rates: SHIPMENT_RATE_PERCENT_BY_CHANNEL.direct },
];

function makeSalesRows(): SalesRowDef[] {
  const rows: SalesRowDef[] = [];

  for (const brand of SALES_BRANDS) {
    const brandId = `brand:${brand}`;
    const dealerId = `dealerCloth:${brand}`;
    const dealerSId = `dealerS:${brand}`;
    const dealerFId = `dealerF:${brand}`;
    const dealerYear1Id = `dealerYear1:${brand}`;
    const dealerNextId = `dealerNext:${brand}`;
    const dealerAccId = `dealerACC:${brand}`;
    const directId = `direct:${brand}`;

    rows.push({
      id: brandId,
      parentId: null,
      level: 1,
      brand,
      channelLabel: '',
      accountLabel: brand,
      isGroup: true,
    });
    rows.push({
      id: dealerId,
      parentId: brandId,
      level: 2,
      brand,
      channelLabel: '대리상',
      accountLabel: '대리상(의류)',
      isGroup: true,
    });
    rows.push({
      id: dealerSId,
      parentId: dealerId,
      level: 3,
      brand,
      channelLabel: '',
      accountLabel: '당년S',
      isGroup: false,
      leafKind: 'dealerCurrS',
    });
    rows.push({
      id: dealerFId,
      parentId: dealerId,
      level: 3,
      brand,
      channelLabel: '',
      accountLabel: '당년F',
      isGroup: false,
      leafKind: 'dealerCurrF',
    });
    rows.push({
      id: dealerYear1Id,
      parentId: dealerId,
      level: 3,
      brand,
      channelLabel: '',
      accountLabel: '1년차',
      isGroup: false,
      leafKind: 'dealerYear1',
    });
    rows.push({
      id: dealerNextId,
      parentId: dealerId,
      level: 3,
      brand,
      channelLabel: '',
      accountLabel: '차기시즌',
      isGroup: false,
      leafKind: 'dealerNext',
    });
    rows.push({
      id: dealerAccId,
      parentId: brandId,
      level: 2,
      brand,
      channelLabel: '대리상',
      accountLabel: '대리상(ACC)',
      isGroup: false,
      leafKind: 'dealerAcc',
    });
    rows.push({
      id: directId,
      parentId: brandId,
      level: 2,
      brand,
      channelLabel: '직영',
      accountLabel: '직영',
      isGroup: false,
      leafKind: 'direct',
    });
  }

  return rows;
}

function emptyMonthlyInputs(): MonthlyInputs {
  const base: Record<string, (number | null)[]> = {};
  for (const account of RAW_ACCOUNTS) {
    base[account] = new Array(12).fill(null);
  }

  return {
    mlb: Object.fromEntries(Object.entries(base).map(([k, v]) => [k, [...v]])) as Record<string, (number | null)[]>,
    kids: Object.fromEntries(Object.entries(base).map(([k, v]) => [k, [...v]])) as Record<string, (number | null)[]>,
    discovery: Object.fromEntries(Object.entries(base).map(([k, v]) => [k, [...v]])) as Record<string, (number | null)[]>,
  };
}

function sumOrNull(values: (number | null)[]): number | null {
  const hasAny = values.some((v) => v !== null);
  if (!hasAny) return null;
  return values.reduce<number>((sum, v) => sum + (v ?? 0), 0);
}

/** 법인 실판매출(V-): FY26 월합(원), PL 시나리오 표와 동일 소스 */
function corpRealSalesAnnual26Yuan(result: ScenarioResult): number | null {
  const series = result.corporate.salesActual.total;
  return sumOrNull(series ?? []);
}

/** 부정·긍정: 법인 실판매출(V-)(FY26 월합 원) 시나리오−기존계획을 K 정수로 */
function corpRealSalesVsBaseDeltaK(scKey: ScenarioKey, scenarioData: AllScenarioData | null): number | null {
  if (!scenarioData || scKey === 'base') return null;
  const sSc = corpRealSalesAnnual26Yuan(scenarioData[scKey]);
  const sBase = corpRealSalesAnnual26Yuan(scenarioData.base);
  if (sSc == null || sBase == null) return null;
  return Math.round((sSc - sBase) / 1000);
}

/** 법인 매출원가: FY26 월합(원), PL 시나리오 표와 동일 소스 */
function corpCogsAnnual26Yuan(result: ScenarioResult): number | null {
  const series = result.corporate.calculated.monthly['매출원가'];
  return sumOrNull(series ?? []);
}

/** 부정·긍정: 법인 매출원가(FY26 월합 원) 시나리오−기존계획을 K 정수로 */
function corpCogsVsBaseDeltaK(scKey: ScenarioKey, scenarioData: AllScenarioData | null): number | null {
  if (!scenarioData || scKey === 'base') return null;
  const cSc = corpCogsAnnual26Yuan(scenarioData[scKey]);
  const cBase = corpCogsAnnual26Yuan(scenarioData.base);
  if (cSc == null || cBase == null) return null;
  return Math.round((cSc - cBase) / 1000);
}

/** 법인 직접비+영업비: FY26 월합(원), PL 시나리오 표와 동일 */
function corpDirectOpexAnnual26Yuan(result: ScenarioResult): number | null {
  const m = result.corporate.calculated.monthly;
  const d = m['직접비'] ?? [];
  const o = m['영업비'] ?? [];
  const combined = Array.from({ length: 12 }, (_, i) => {
    const di = d[i] ?? null;
    const oi = o[i] ?? null;
    if (di === null && oi === null) return null;
    return (di ?? 0) + (oi ?? 0);
  });
  return sumOrNull(combined);
}

/** 부정·긍정: (직접비+영업비) FY26 시나리오−기존계획을 K 정수로 */
function corpDirectOpexVsBaseDeltaK(scKey: ScenarioKey, scenarioData: AllScenarioData | null): number | null {
  if (!scenarioData || scKey === 'base') return null;
  const xSc = corpDirectOpexAnnual26Yuan(scenarioData[scKey]);
  const xBase = corpDirectOpexAnnual26Yuan(scenarioData.base);
  if (xSc == null || xBase == null) return null;
  return Math.round((xSc - xBase) / 1000);
}

/**
 * 시뮬 「부정/긍정 조정」행 연간(원): PL 비용 증감과 CF(비용=유출) 부호 맞춤 위해 −Δ×1000.
 * 기존계획 CF 금액 없음 — 표시는 차액만.
 */
function cfSimPosNegAdjustYuan(scKey: ScenarioKey, scenarioData: AllScenarioData | null): number | null {
  const dK = corpDirectOpexVsBaseDeltaK(scKey, scenarioData);
  if (dK == null) return null;
  return -dK * 1000;
}

/** 법인 영업이익: FY26 월합(원), PL 시나리오 표와 동일 */
function corpOperatingProfitAnnual26Yuan(result: ScenarioResult): number | null {
  const series = result.corporate.calculated.monthly['영업이익(관리식)'];
  return sumOrNull(series ?? []);
}

/**
 * 시뮬 「법인세 조정」행 연간(원): − round(0.25×(OI_sc−OI_base)/1000)×1000 (CF 비용 유출 부호).
 * 기존계획 CF 금액 없음 — 표시는 차액만.
 */
function cfSimCorpTaxAdjustYuan(scKey: ScenarioKey, scenarioData: AllScenarioData | null): number | null {
  if (!scenarioData || scKey === 'base') return null;
  const oiSc = corpOperatingProfitAnnual26Yuan(scenarioData[scKey]);
  const oiBase = corpOperatingProfitAnnual26Yuan(scenarioData.base);
  if (oiSc == null || oiBase == null) return null;
  const taxDeltaK = Math.round((SCENARIO_CF_CORP_TAX_RATE * (oiSc - oiBase)) / 1000);
  return -taxDeltaK * 1000;
}

function makeMonthlyArray(calc: (idx: number) => number | null): (number | null)[] {
  return Array.from({ length: 12 }, (_, idx) => calc(idx));
}

function sumMonthlySeries(series: Record<string, (number | null)[]>, accounts: string[]): (number | null)[] {
  return makeMonthlyArray((idx) => {
    let hasAny = false;
    let sum = 0;
    for (const account of accounts) {
      const v = series[account]?.[idx] ?? null;
      if (v !== null) {
        hasAny = true;
        sum += v;
      }
    }
    return hasAny ? sum : null;
  });
}

function deriveCalculated(
  rawMonthly: Record<string, (number | null)[]>,
  annualRaw2025: Record<string, number>,
  adjustData26?: Record<string, (number | null)[]>,
  adjustData25?: Record<string, (number | null)[]>,
): CalculatedSeries {
  const monthly: Record<string, (number | null)[]> = { ...rawMonthly };

  monthly['매출원가 합계'] = makeMonthlyArray((idx) => {
    const cogs = monthly['매출원가']?.[idx] ?? null;
    const evalLoss = monthly['평가감']?.[idx] ?? null;
    if (cogs === null && evalLoss === null) return null;
    return (cogs ?? 0) + (evalLoss ?? 0);
  });

  monthly['(Tag 대비 원가율)'] = makeMonthlyArray((idx) => {
    const tag = monthly['Tag매출']?.[idx] ?? null;
    const cogs = monthly['매출원가']?.[idx] ?? null;
    if (tag === null || tag === 0 || cogs === null) return null;
    return (cogs * 1.13) / tag;
  });

  monthly['매출총이익'] = makeMonthlyArray((idx) => {
    const sales = monthly['실판매출']?.[idx] ?? null;
    const cogsTotal = monthly['매출원가 합계']?.[idx] ?? null;
    if (sales === null && cogsTotal === null) return null;
    return (sales ?? 0) - (cogsTotal ?? 0);
  });

  monthly['직접비'] = sumMonthlySeries(monthly, DIRECT_EXPENSE_ACCOUNTS);
  monthly['영업비'] = sumMonthlySeries(monthly, OPERATING_EXPENSE_ACCOUNTS);

  monthly['영업이익(관리식)'] = makeMonthlyArray((idx) => {
    const gp = monthly['매출총이익']?.[idx] ?? null;
    const direct = monthly['직접비']?.[idx] ?? null;
    const op = monthly['영업비']?.[idx] ?? null;
    if (gp === null && direct === null && op === null) return null;
    return (gp ?? 0) - (direct ?? 0) - (op ?? 0);
  });

  monthly['영업이익률(관리식)'] = makeMonthlyArray((idx) => {
    const oi = monthly['영업이익(관리식)']?.[idx] ?? null;
    const sales = monthly['실판매출']?.[idx] ?? null;
    if (oi === null || sales === null || sales === 0) return null;
    return oi / sales;
  });

  const annual2025: Record<string, number | null> = {};
  for (const account of RAW_ACCOUNTS) {
    annual2025[account] = annualRaw2025[account] ?? 0;
  }

  annual2025['매출원가 합계'] = (annual2025['매출원가'] ?? 0) + (annual2025['평가감'] ?? 0);
  annual2025['(Tag 대비 원가율)'] =
    (annual2025['Tag매출'] ?? 0) !== 0
      ? ((annual2025['매출원가'] ?? 0) * 1.13) / (annual2025['Tag매출'] as number)
      : null;
  annual2025['매출총이익'] = (annual2025['실판매출'] ?? 0) - (annual2025['매출원가 합계'] ?? 0);
  annual2025['직접비'] = DIRECT_EXPENSE_ACCOUNTS.reduce((sum, account) => sum + (annual2025[account] ?? 0), 0);
  annual2025['영업비'] = OPERATING_EXPENSE_ACCOUNTS.reduce((sum, account) => sum + (annual2025[account] ?? 0), 0);
  annual2025['영업이익(관리식)'] = (annual2025['매출총이익'] ?? 0) - (annual2025['직접비'] ?? 0) - (annual2025['영업비'] ?? 0);
  annual2025['영업이익률(관리식)'] =
    (annual2025['실판매출'] ?? 0) !== 0 ? (annual2025['영업이익(관리식)'] ?? 0) / (annual2025['실판매출'] as number) : null;

  // 재무조정 행 추가
  if (adjustData26 && Object.keys(adjustData26).length > 0) {
    // FY26 월별: 하위 계정
    for (const acc of FINANCIAL_ADJUST_ACCOUNTS) {
      monthly[acc] = adjustData26[acc] ?? new Array(12).fill(0);
    }
    // 재무&관리차이(-) = 하위 계정 합계
    monthly['재무&관리차이(-)'] = makeMonthlyArray((idx) =>
      FINANCIAL_ADJUST_ACCOUNTS.reduce((sum, acc) => sum + ((monthly[acc]?.[idx]) ?? 0), 0)
    );
    // 영업이익(재무식) = 영업이익(관리식) - 재무&관리차이(-)
    monthly['영업이익(재무식)'] = makeMonthlyArray((idx) => {
      const oi = monthly['영업이익(관리식)']?.[idx] ?? null;
      const adj = monthly['재무&관리차이(-)']?.[idx] ?? 0;
      if (oi === null) return null;
      return oi - adj;
    });
    // 영업이익률(재무식) = 영업이익(재무식) / 실판매출
    monthly['영업이익률(재무식)'] = makeMonthlyArray((idx) => {
      const oi = monthly['영업이익(재무식)']?.[idx] ?? null;
      const sales = monthly['실판매출']?.[idx] ?? null;
      if (oi === null || sales === null || sales === 0) return null;
      return oi / sales;
    });

    // FY25 연간: 하위 계정
    if (adjustData25 && Object.keys(adjustData25).length > 0) {
      for (const acc of FINANCIAL_ADJUST_ACCOUNTS) {
        const arr = adjustData25[acc] ?? new Array(12).fill(0);
        annual2025[acc] = arr.reduce((s: number, v) => s + ((v as number) ?? 0), 0);
      }
      annual2025['재무&관리차이(-)'] = FINANCIAL_ADJUST_ACCOUNTS.reduce((sum, acc) => sum + ((annual2025[acc] as number) ?? 0), 0);
    } else {
      for (const acc of FINANCIAL_ADJUST_ACCOUNTS) annual2025[acc] = 0;
      annual2025['재무&관리차이(-)'] = 0;
    }
    annual2025['영업이익(재무식)'] = ((annual2025['영업이익(관리식)'] ?? 0) as number) - ((annual2025['재무&관리차이(-)'] ?? 0) as number);
    annual2025['영업이익률(재무식)'] =
      (annual2025['실판매출'] ?? 0) !== 0
        ? (annual2025['영업이익(재무식)'] as number) / (annual2025['실판매출'] as number)
        : null;
  }

  return { monthly, annual2025 };
}

function formatValue(value: number | null, format: 'number' | 'percent' = 'number'): string {
  if (value === null || Number.isNaN(value)) return '';
  if (format === 'percent') return `${(value * 100).toFixed(1)}%`;
  const kValue = Math.round(value / 1000);
  return new Intl.NumberFormat('ko-KR').format(kValue);
}

function formatYoYByAnnual(annual26: number | null, annual25: number | null): string {
  if (annual26 === null || annual25 === null || Number.isNaN(annual26) || Number.isNaN(annual25) || annual25 === 0) return '-';
  return `${((annual26 / annual25) * 100).toFixed(1)}%`;
}

function sumSeries(a: (number | null)[], b: (number | null)[]): (number | null)[] {
  return a.map((v, i) => {
    const x = v ?? null;
    const y = b[i] ?? null;
    if (x === null && y === null) return null;
    return (x ?? 0) + (y ?? 0);
  });
}

function applyRate(series: (number | null)[], percent: number): (number | null)[] {
  return series.map((v) => (v === null ? null : (v * percent) / 100 / 1.13));
}

function isSameSeries(a: (number | null)[], b: (number | null)[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if ((a[i] ?? null) !== (b[i] ?? null)) return false;
  }
  return true;
}

function splitByPlannedRatio(
  total: number | null,
  plannedA: number | null,
  plannedB: number | null,
): { a: number | null; b: number | null } {
  if (total === null) return { a: null, b: null };
  const pa = plannedA ?? 0;
  const pb = plannedB ?? 0;
  const sum = pa + pb;
  if (sum <= 0) {
    return { a: total / 2, b: total / 2 };
  }
  const a = (total * pa) / sum;
  return { a, b: total - a };
}

function sumSeriesValues(series: (number | null)[]): number {
  return series.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

function distributeRemainingByPattern(
  annualTarget: number,
  fixedSeries: (number | null)[],
  patternSeries: (number | null)[],
  startMonthIndex: number,
  eligibleMonthIndexes?: number[],
): (number | null)[] {
  const result = [...fixedSeries];
  const remaining = annualTarget - sumSeriesValues(fixedSeries);
  const monthIndexes =
    eligibleMonthIndexes ??
    Array.from({ length: 12 - startMonthIndex }, (_, idx) => startMonthIndex + idx);

  const targets = monthIndexes.filter((idx) => idx >= startMonthIndex && idx < 12);
  if (targets.length === 0) return result;

  const weights = targets.map((idx) => Math.max(patternSeries[idx] ?? 0, 0));
  const weightSum = weights.reduce((sum, value) => sum + value, 0);

  if (weightSum > 0) {
    targets.forEach((idx, i) => {
      result[idx] = remaining * (weights[i] / weightSum);
    });
    return result;
  }

  const even = remaining / targets.length;
  targets.forEach((idx) => {
    result[idx] = even;
  });
  return result;
}

const DEFAULT_GROWTH_PARAMS: InventoryGrowthParams = {
  growthRate: 5,
  growthRateHq: 17,
  growthRateByBrand: { MLB: 5, 'MLB KIDS': -3, DISCOVERY: 300 },
  growthRateHqByBrand: { MLB: 15, 'MLB KIDS': 8, DISCOVERY: 100 },
};

function readInventoryGrowthParams(): InventoryGrowthParams {
  if (typeof window === 'undefined') return DEFAULT_GROWTH_PARAMS;
  const raw = window.localStorage.getItem(INVENTORY_GROWTH_PARAMS_KEY);
  if (!raw) return DEFAULT_GROWTH_PARAMS;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const growthRate = typeof parsed.growthRate === 'number' ? parsed.growthRate : 5;
    const growthRateHq = typeof parsed.growthRateHq === 'number' ? parsed.growthRateHq : 17;
    const rawByBrand = parsed.growthRateByBrand as Record<string, number> | undefined;
    const rawHqByBrand = parsed.growthRateHqByBrand as Record<string, number> | undefined;
    const growthRateByBrand: Record<SalesBrand, number> = {
      MLB: typeof rawByBrand?.MLB === 'number' ? rawByBrand.MLB : 5,
      'MLB KIDS': typeof rawByBrand?.['MLB KIDS'] === 'number' ? rawByBrand['MLB KIDS'] : -3,
      DISCOVERY: typeof rawByBrand?.DISCOVERY === 'number' ? rawByBrand.DISCOVERY : 300,
    };
    const growthRateHqByBrand: Record<SalesBrand, number> = {
      MLB: typeof rawHqByBrand?.MLB === 'number' ? rawHqByBrand.MLB : 15,
      'MLB KIDS': typeof rawHqByBrand?.['MLB KIDS'] === 'number' ? rawHqByBrand['MLB KIDS'] : 8,
      DISCOVERY: typeof rawHqByBrand?.DISCOVERY === 'number' ? rawHqByBrand.DISCOVERY : 100,
    };
    return { growthRate, growthRateHq, growthRateByBrand, growthRateHqByBrand };
  } catch {
    return DEFAULT_GROWTH_PARAMS;
  }
}

type PLForecastTabProps = {
  /**
   * 재고자산(sim)에서 "재계산/저장"으로 상위(app/page.tsx)가 들고 있는 시나리오 재고.
   * - 값이 있으면 PL(sim) 시나리오 모달은 이걸 우선 사용한다.
   * - null이면 `/api/inventory/scenario-inventory` GET으로 기본값(git에 커밋된 JSON) 읽음.
   */
  scenarioOverride?: ScenarioInventoryPayload | null;
};

export default function PLForecastTab({ scenarioOverride = null }: PLForecastTabProps = {}) {
  const [activeBrand, setActiveBrand] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(['리테일매출', 'Tag매출', '실판매출', '매출원가 합계', '직접비', '영업비', '재무&관리차이(-)']));
  const [logicGuideCollapsed, setLogicGuideCollapsed] = useState<boolean>(true);
  const [monthlyInputs, setMonthlyInputs] = useState<MonthlyInputs>(emptyMonthlyInputs);
  const [salesSectionOpen, setSalesSectionOpen] = useState<boolean>(false);
  const [directExpenseRatioSectionOpen, setDirectExpenseRatioSectionOpen] = useState<boolean>(false);
  const [tagCostRatioSectionOpen, setTagCostRatioSectionOpen] = useState<boolean>(false);
  const [prevYearDiscountSectionOpen, setPrevYearDiscountSectionOpen] = useState<boolean>(false);
  const [prevYearDiscountByBrand, setPrevYearDiscountByBrand] = useState<Record<SalesBrand, { dealer: (number | null)[]; direct: (number | null)[] }>>({
    MLB: { dealer: new Array(12).fill(null), direct: new Array(12).fill(null) },
    'MLB KIDS': { dealer: new Array(12).fill(null), direct: new Array(12).fill(null) },
    DISCOVERY: { dealer: new Array(12).fill(null), direct: new Array(12).fill(null) },
  });
  const [prevYearDiscountLoading, setPrevYearDiscountLoading] = useState<boolean>(false);
  const [prevYearDiscountError, setPrevYearDiscountError] = useState<string | null>(null);
  const [salesCollapsed, setSalesCollapsed] = useState<Set<string>>(new Set());
  const [otbLoading, setOtbLoading] = useState<boolean>(false);
  const [otbError, setOtbError] = useState<string | null>(null);
  const [otbData, setOtbData] = useState<Record<string, Record<string, number>> | null>(null);
  const [retailLoading, setRetailLoading] = useState<boolean>(false);
  const [retailError, setRetailError] = useState<string | null>(null);
  const [growthParams, setGrowthParams] = useState<InventoryGrowthParams>(DEFAULT_GROWTH_PARAMS);

  // 재고자산(sim) 리테일 성장률(base)에서 부정/긍정 오프셋을 적용한 동적 시나리오 성장률
  const effectiveScenarioGrowthRates = useMemo(
    () => computeEffectiveGrowthRates(growthParams.growthRateByBrand, growthParams.growthRateHqByBrand),
    [growthParams],
  );

  const [dealerTagRetailByBrand, setDealerTagRetailByBrand] = useState<Record<SalesBrand, (number | null)[]>>({
    MLB: new Array(12).fill(null),
    'MLB KIDS': new Array(12).fill(null),
    DISCOVERY: new Array(12).fill(null),
  });
  const [directRetailByBrand, setDirectRetailByBrand] = useState<Record<SalesBrand, (number | null)[]>>({
    MLB: new Array(12).fill(null),
    'MLB KIDS': new Array(12).fill(null),
    DISCOVERY: new Array(12).fill(null),
  });
  const [shipmentProgressLoading, setShipmentProgressLoading] = useState<boolean>(false);
  const [shipmentProgressError, setShipmentProgressError] = useState<string | null>(null);
  const [shipmentProgressRows, setShipmentProgressRows] = useState<ShipmentProgressRow[]>([]);
  const [dealerAccOtbByBrand, setDealerAccOtbByBrand] = useState<Record<SalesBrand, number>>({
    MLB: 0,
    'MLB KIDS': 0,
    DISCOVERY: 0,
  });
  const [accRatioLoading, setAccRatioLoading] = useState<boolean>(false);
  const [accRatioError, setAccRatioError] = useState<string | null>(null);
  const [accRatioRows, setAccRatioRows] = useState<AccShipmentRatioRow[]>([]);
  const [brandActualLoading, setBrandActualLoading] = useState<boolean>(false);
  const [brandActualError, setBrandActualError] = useState<string | null>(null);
  const [brandActualAvailableMonths, setBrandActualAvailableMonths] = useState<number[]>([]);
  const emptyBrandActual = (): BrandActualData => ({
    tag: { dealer: new Array(12).fill(null), direct: new Array(12).fill(null), dealerCloth: new Array(12).fill(null), dealerAcc: new Array(12).fill(null) },
    sales: { dealer: new Array(12).fill(null), direct: new Array(12).fill(null), dealerCloth: new Array(12).fill(null), dealerAcc: new Array(12).fill(null) },
    retail: { dealer: new Array(12).fill(null), direct: new Array(12).fill(null) },
    accounts: {},
  });
  const [brandActualByBrand, setBrandActualByBrand] = useState<Record<SalesBrand, BrandActualData>>({
    MLB: emptyBrandActual(),
    'MLB KIDS': emptyBrandActual(),
    DISCOVERY: emptyBrandActual(),
  });
  const [salesSupportActualLoading, setSalesSupportActualLoading] = useState<boolean>(false);
  const [salesSupportActualError, setSalesSupportActualError] = useState<string | null>(null);
  const [salesSupportActualAvailableMonths, setSalesSupportActualAvailableMonths] = useState<number[]>([]);
  const emptySalesSupportActual = (): Record<SalesSupportActualKey, (number | null)[]> => ({
    당년S: new Array(12).fill(null),
    당년F: new Array(12).fill(null),
    '1년차': new Array(12).fill(null),
    차기시즌: new Array(12).fill(null),
    ACC: new Array(12).fill(null),
  });
  const [salesSupportActualByBrand, setSalesSupportActualByBrand] = useState<Record<SalesBrand, Record<SalesSupportActualKey, (number | null)[]>>>({
    MLB: emptySalesSupportActual(),
    'MLB KIDS': emptySalesSupportActual(),
    DISCOVERY: emptySalesSupportActual(),
  });
  const [opexForecastLoading, setOpexForecastLoading] = useState<boolean>(false);
  const [opexForecastError, setOpexForecastError] = useState<string | null>(null);
  const [opexForecastByBrand, setOpexForecastByBrand] = useState<Record<SalesBrand, Record<string, (number | null)[]>>>({
    MLB: {},
    'MLB KIDS': {},
    DISCOVERY: {},
  });
  // 재무조정 데이터 (FY26 + FY25)
  const [financialAdjust26, setFinancialAdjust26] = useState<Record<string, (number | null)[]>>({});
  const [financialAdjust25, setFinancialAdjust25] = useState<Record<string, (number | null)[]>>({});

  const [directExpenseRatioLoading, setDirectExpenseRatioLoading] = useState<boolean>(false);
  const [directExpenseRatioError, setDirectExpenseRatioError] = useState<string | null>(null);
  const [directExpenseRatioByBrand, setDirectExpenseRatioByBrand] = useState<Record<SalesBrand, Record<string, (number | null)[]>>>({
    MLB: {},
    'MLB KIDS': {},
    DISCOVERY: {},
  });
  const [tagCostRatioLoading, setTagCostRatioLoading] = useState<boolean>(false);
  const [tagCostRatioError, setTagCostRatioError] = useState<string | null>(null);
  const [tagCostRatioByBrand, setTagCostRatioByBrand] = useState<Record<SalesBrand, (number | null)[]>>({
    MLB: new Array(12).fill(null),
    'MLB KIDS': new Array(12).fill(null),
    DISCOVERY: new Array(12).fill(null),
  });

  // ─── 시나리오 모달 상태 ───────────────────────────────────────────────────────
  const [scenarioModalOpen, setScenarioModalOpen] = useState(false);
  const [scenarioLoading, setScenarioLoading] = useState(false);
  const [scenarioError, setScenarioError] = useState<string | null>(null);
  const [scenarioData, setScenarioData] = useState<AllScenarioData | null>(null);
  const [scenarioModalBrand, setScenarioModalBrand] = useState<string | null>(null);

  // 재고자산(sim)에서 "재계산/저장"으로 override가 갱신되면 캐시된 시나리오 결과를 무효화.
  // → 다음 모달 열기에서 새 값으로 다시 계산 (openScenarioModal의 early-return 방지)
  useEffect(() => {
    setScenarioData(null);
  }, [scenarioOverride]);
  const [scenarioCollapsedAccounts, setScenarioCollapsedAccounts] = useState<Set<string>>(
    new Set(['Tag매출', '실판매출', '매출원가 합계', '직접비', '영업비', '재무&관리차이(-)']),
  );
  const [scenarioExpandedScenarios, setScenarioExpandedScenarios] = useState<Set<ScenarioKey>>(new Set());
  const [scenarioViewMode, setScenarioViewMode] = useState<'summary' | 'full'>('summary');
  const [wcInvBrandOpen, setWcInvBrandOpen] = useState(false);
  const [wcLegendOpen, setWcLegendOpen] = useState(false);

  // 시나리오 운전자본표 데이터
  const [scenarioWcData, setScenarioWcData] = useState<{
    actual2025: ScenarioWcRow;
    scenarios: Record<ScenarioKey, ScenarioWcRow>;
    invDataMissing: boolean;
  } | null>(null);

  const [scenarioCfRows, setScenarioCfRows] = useState<CFHierarchyApiRow[] | null>(null);
  const [scenarioCfError, setScenarioCfError] = useState<string | null>(null);
  const [scenarioCfCollapsed, setScenarioCfCollapsed] = useState<Set<string>>(() => new Set(['자산성지출']));
  const [scenarioCfAllCollapsed, setScenarioCfAllCollapsed] = useState(true);
  const [scenarioCfLegendOpen, setScenarioCfLegendOpen] = useState(false);
  const scenarioCfRowsLengthRef = useRef(0);
  /** 기존계획 열: 현금차입금잔액/2026.csv 기말잔액 (= cash-borrowing API 시리즈 인덱스 13) K */
  const [scenarioCashBorrowPlanK, setScenarioCashBorrowPlanK] = useState<{
    cash: number | null;
    debt: number | null;
  } | null>(null);
  // ─────────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!scenarioModalOpen) {
      setScenarioCashBorrowPlanK(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/fs/cash-borrowing?year=2026', { cache: 'no-store' });
        const json = (await res.json()) as { cash?: number[]; borrowing?: number[]; error?: string };
        if (cancelled) return;
        if (!res.ok) {
          setScenarioCashBorrowPlanK(null);
          return;
        }
        const c = Array.isArray(json.cash) && json.cash.length > 13 ? json.cash[13] : null;
        const b = Array.isArray(json.borrowing) && json.borrowing.length > 13 ? json.borrowing[13] : null;
        const cashK = c != null && Number.isFinite(c) ? Math.round(c / 1000) : null;
        const debtK = b != null && Number.isFinite(b) ? Math.round(b / 1000) : null;
        setScenarioCashBorrowPlanK({ cash: cashK, debt: debtK });
      } catch {
        if (!cancelled) setScenarioCashBorrowPlanK(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scenarioModalOpen]);

  useEffect(() => {
    if (!scenarioModalOpen) {
      scenarioCfRowsLengthRef.current = 0;
      return;
    }
    setScenarioCfRows(null);
    setScenarioCfError(null);
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/fs/cf-hierarchy?year=2026', { cache: 'no-store' });
        const json = (await res.json()) as { rows?: CFHierarchyApiRow[]; error?: string };
        if (cancelled) return;
        if (res.ok && Array.isArray(json.rows)) {
          setScenarioCfRows(json.rows);
          setScenarioCfError(null);
        } else {
          setScenarioCfRows(null);
          setScenarioCfError(typeof json?.error === 'string' ? json.error : '현금흐름표를 불러오지 못했습니다.');
        }
      } catch {
        if (!cancelled) {
          setScenarioCfRows(null);
          setScenarioCfError('현금흐름표를 불러오지 못했습니다.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scenarioModalOpen]);

  useEffect(() => {
    const len = scenarioCfRows?.length ?? 0;
    if (len > 0) {
      if (scenarioCfRowsLengthRef.current === 0 && scenarioCfRows) {
        const groups = scenarioCfRows.filter((r) => r.isGroup).map((r) => r.account);
        if (groups.length) {
          const next = new Set(groups);
          next.add('자산성지출');
          setScenarioCfCollapsed(next);
          setScenarioCfAllCollapsed(true);
        }
      }
      scenarioCfRowsLengthRef.current = len;
    } else if (len === 0) {
      scenarioCfRowsLengthRef.current = 0;
    }
  }, [scenarioCfRows]);

  const scenarioCfVisibleRows = useMemo(() => {
    const rows = scenarioCfRows ?? [];
    const result: CFHierarchyApiRow[] = [];
    let skipLevel = -1;
    for (const row of rows) {
      if (row.level <= skipLevel) skipLevel = -1;
      if (skipLevel >= 0 && row.level > skipLevel) continue;
      if (row.isGroup && scenarioCfCollapsed.has(row.account)) {
        skipLevel = row.level === 0 ? 0 : row.level;
        result.push(row);
        continue;
      }
      result.push(row);
    }
    return result;
  }, [scenarioCfRows, scenarioCfCollapsed]);

  useEffect(() => {
    let mounted = true;
    const fetchOtb = async () => {
      setOtbLoading(true);
      setOtbError(null);
      try {
        const res = await fetch('/api/inventory/otb?year=2026', { cache: 'no-store' });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || 'OTB 데이터를 불러오지 못했습니다.');
        if (mounted) setOtbData(json?.data ?? null);
      } catch (err) {
        if (mounted) {
          setOtbError(err instanceof Error ? err.message : 'OTB 데이터를 불러오지 못했습니다.');
        }
      } finally {
        if (mounted) setOtbLoading(false);
      }
    };
    fetchOtb();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const fetchShipmentProgress = async () => {
      setShipmentProgressLoading(true);
      setShipmentProgressError(null);
      try {
        const res = await fetch('/api/inventory/shipment-progress', { cache: 'no-store' });
        const json = (await res.json()) as { rows?: ShipmentProgressRow[]; error?: string };
        if (!res.ok) throw new Error(json?.error || '출고진척률 데이터를 불러오지 못했습니다.');
        if (mounted) setShipmentProgressRows(json.rows ?? []);
      } catch (err) {
        if (mounted) {
          setShipmentProgressError(err instanceof Error ? err.message : '출고진척률 데이터를 불러오지 못했습니다.');
        }
      } finally {
        if (mounted) setShipmentProgressLoading(false);
      }
    };
    fetchShipmentProgress();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const fetchAccRatio = async () => {
      setAccRatioLoading(true);
      setAccRatioError(null);
      try {
        const res = await fetch('/api/inventory/acc-shipment-ratio', { cache: 'no-store' });
        const json = (await res.json()) as { rows?: AccShipmentRatioRow[]; error?: string };
        if (!res.ok) throw new Error(json?.error || 'ACC 출고비율 데이터를 불러오지 못했습니다.');
        if (mounted) setAccRatioRows(json.rows ?? []);
      } catch (err) {
        if (mounted) {
          setAccRatioError(err instanceof Error ? err.message : 'ACC 출고비율 데이터를 불러오지 못했습니다.');
        }
      } finally {
        if (mounted) setAccRatioLoading(false);
      }
    };
    fetchAccRatio();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const fetchBrandActual = async () => {
      setBrandActualLoading(true);
      setBrandActualError(null);
      try {
        const res = await fetch('/api/pl-forecast/brand-actual?year=2026', { cache: 'no-store' });
        const json = (await res.json()) as BrandActualApiResponse;
        if (!res.ok) throw new Error(json?.error || '브랜드 실적 데이터를 불러오지 못했습니다.');
        if (!mounted) return;
        setBrandActualAvailableMonths(json.availableMonths ?? []);
        setBrandActualByBrand(
          json.brands ?? {
            MLB: emptyBrandActual(),
            'MLB KIDS': emptyBrandActual(),
            DISCOVERY: emptyBrandActual(),
          },
        );
      } catch (err) {
        if (mounted) {
          setBrandActualAvailableMonths([]);
          setBrandActualError(err instanceof Error ? err.message : '브랜드 실적 데이터를 불러오지 못했습니다.');
        }
      } finally {
        if (mounted) setBrandActualLoading(false);
      }
    };
    fetchBrandActual();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const fetchSalesSupportActual = async () => {
      setSalesSupportActualLoading(true);
      setSalesSupportActualError(null);
      try {
        const res = await fetch('/api/pl-forecast/sales-support-actual?year=2026', { cache: 'no-store' });
        const json = (await res.json()) as SalesSupportActualApiResponse;
        if (!res.ok) throw new Error(json?.error || '매출보조지표 실적 데이터를 불러오지 못했습니다.');
        if (!mounted) return;
        setSalesSupportActualAvailableMonths(json.availableMonths ?? []);
        setSalesSupportActualByBrand(
          json.brands ?? {
            MLB: emptySalesSupportActual(),
            'MLB KIDS': emptySalesSupportActual(),
            DISCOVERY: emptySalesSupportActual(),
          },
        );
      } catch (err) {
        if (mounted) {
          setSalesSupportActualAvailableMonths([]);
          setSalesSupportActualError(err instanceof Error ? err.message : '매출보조지표 실적 데이터를 불러오지 못했습니다.');
        }
      } finally {
        if (mounted) setSalesSupportActualLoading(false);
      }
    };

    fetchSalesSupportActual();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const fetchOpexForecast = async () => {
      setOpexForecastLoading(true);
      setOpexForecastError(null);
      try {
        const res = await fetch('/api/pl-forecast/opex-forecast?year=2026', { cache: 'no-store' });
        const json = (await res.json()) as OpexForecastApiResponse;
        if (!res.ok) throw new Error(json?.error || '영업비 계획 데이터를 불러오지 못했습니다.');
        if (!mounted) return;
        setOpexForecastByBrand(
          json.brands ?? {
            MLB: {},
            'MLB KIDS': {},
            DISCOVERY: {},
          },
        );
      } catch (err) {
        if (mounted) {
          setOpexForecastError(err instanceof Error ? err.message : '영업비 계획 데이터를 불러오지 못했습니다.');
        }
      } finally {
        if (mounted) setOpexForecastLoading(false);
      }
    };
    fetchOpexForecast();
    return () => {
      mounted = false;
    };
  }, []);

  // 재무조정 데이터 로드 (FY26 + FY25)
  useEffect(() => {
    let mounted = true;
    const fetchAdjust = async () => {
      try {
        const [res26, res25] = await Promise.all([
          fetch('/api/pl-forecast/financial-adjust?year=2026', { cache: 'no-store' }),
          fetch('/api/pl-forecast/financial-adjust?year=2025', { cache: 'no-store' }),
        ]);
        const json26 = await res26.json();
        const json25 = await res25.json();
        if (!mounted) return;
        setFinancialAdjust26(json26.accounts ?? {});
        setFinancialAdjust25(json25.accounts ?? {});
      } catch { /* 무시 */ }
    };
    fetchAdjust();
    return () => { mounted = false; };
  }, []);

  // 전년할인율 데이터 로드
  useEffect(() => {
    let mounted = true;
    const fetchDiscount = async () => {
      setPrevYearDiscountLoading(true);
      setPrevYearDiscountError(null);
      try {
        const res = await fetch('/api/pl-forecast/prev-year-discount', { cache: 'no-store' });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || '전년할인율 데이터를 불러오지 못했습니다.');
        if (!mounted) return;
        if (json.brands) setPrevYearDiscountByBrand(json.brands);
      } catch (err) {
        if (mounted) setPrevYearDiscountError(err instanceof Error ? err.message : '전년할인율 데이터를 불러오지 못했습니다.');
      } finally {
        if (mounted) setPrevYearDiscountLoading(false);
      }
    };
    fetchDiscount();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    let mounted = true;
    const fetchDirectExpenseRatio = async () => {
      setDirectExpenseRatioLoading(true);
      setDirectExpenseRatioError(null);
      try {
        const res = await fetch('/api/pl-forecast/direct-expense-ratio?year=2026', { cache: 'no-store' });
        const json = (await res.json()) as DirectExpenseRatioApiResponse;
        if (!res.ok) throw new Error(json?.error || '직접비율 데이터를 불러오지 못했습니다.');
        if (!mounted) return;
        setDirectExpenseRatioByBrand(
          json.brands ?? {
            MLB: {},
            'MLB KIDS': {},
            DISCOVERY: {},
          },
        );
      } catch (err) {
        if (mounted) {
          setDirectExpenseRatioError(err instanceof Error ? err.message : '직접비율 데이터를 불러오지 못했습니다.');
        }
      } finally {
        if (mounted) setDirectExpenseRatioLoading(false);
      }
    };
    fetchDirectExpenseRatio();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const fetchTagCostRatio = async () => {
      setTagCostRatioLoading(true);
      setTagCostRatioError(null);
      try {
        const res = await fetch('/api/pl-forecast/tag-cost-ratio?year=2026', { cache: 'no-store' });
        const json = (await res.json()) as TagCostRatioApiResponse;
        if (!res.ok) throw new Error(json?.error || 'Tag대비원가율 데이터를 불러오지 못했습니다.');
        if (!mounted) return;
        setTagCostRatioByBrand(
          json.brands ?? {
            MLB: new Array(12).fill(null),
            'MLB KIDS': new Array(12).fill(null),
            DISCOVERY: new Array(12).fill(null),
          },
        );
      } catch (err) {
        if (mounted) {
          setTagCostRatioError(err instanceof Error ? err.message : 'Tag대비원가율 데이터를 불러오지 못했습니다.');
        }
      } finally {
        if (mounted) setTagCostRatioLoading(false);
      }
    };
    fetchTagCostRatio();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const updateGrowthParams = () => {
      const next = readInventoryGrowthParams();
      setGrowthParams((prev) => {
        if (
          prev.growthRate === next.growthRate &&
          prev.growthRateHq === next.growthRateHq &&
          SALES_BRANDS.every(
            (b) =>
              prev.growthRateByBrand[b] === next.growthRateByBrand[b] &&
              prev.growthRateHqByBrand[b] === next.growthRateHqByBrand[b],
          )
        ) return prev;
        return next;
      });
    };

    updateGrowthParams();
    window.addEventListener('inventory-growth-updated', updateGrowthParams as EventListener);
    window.addEventListener('storage', updateGrowthParams);
    return () => {
      window.removeEventListener('inventory-growth-updated', updateGrowthParams as EventListener);
      window.removeEventListener('storage', updateGrowthParams);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const fetchDirectRetail = async () => {
      setRetailLoading(true);
      setRetailError(null);
      try {
        const entries = await Promise.all(
          SALES_BRANDS.map(async (brand) => {
            const params = new URLSearchParams({
              year: '2026',
              brand,
              growthRate: String(growthParams.growthRateByBrand[brand] ?? growthParams.growthRate),
              growthRateHq: String(growthParams.growthRateHqByBrand[brand] ?? growthParams.growthRateHq),
            });
            const res = await fetch(`/api/inventory/retail-sales?${params}`, { cache: 'no-store' });
            const json = (await res.json()) as RetailSalesApiResponse & { error?: string };
            if (!res.ok) {
              throw new Error(json?.error || `${brand} 리테일 매출 데이터를 불러오지 못했습니다.`);
            }
            const hqTotalRow = json?.hq?.rows?.find((row) => row.isTotal);
            const hqMonthly = [...(hqTotalRow?.monthly ?? new Array(12).fill(null))];
            const dealerTotalRow = json?.dealer?.rows?.find((row) => row.isTotal);
            const dealerMonthly = [...(dealerTotalRow?.monthly ?? new Array(12).fill(null))];
            return [brand, hqMonthly, dealerMonthly] as const;
          }),
        );

        if (mounted) {
          const nextHq: Record<SalesBrand, (number | null)[]> = {
            MLB: new Array(12).fill(null),
            'MLB KIDS': new Array(12).fill(null),
            DISCOVERY: new Array(12).fill(null),
          };
          const nextDealer: Record<SalesBrand, (number | null)[]> = {
            MLB: new Array(12).fill(null),
            'MLB KIDS': new Array(12).fill(null),
            DISCOVERY: new Array(12).fill(null),
          };
          for (const [brand, hqMonthly, dealerMonthly] of entries) {
            nextHq[brand] = hqMonthly;
            nextDealer[brand] = dealerMonthly;
          }
          setDirectRetailByBrand(nextHq);
          setDealerTagRetailByBrand(nextDealer);
        }
      } catch (err) {
        if (mounted) setRetailError(err instanceof Error ? err.message : '직영 매출 데이터를 불러오지 못했습니다.');
      } finally {
        if (mounted) setRetailLoading(false);
      }
    };

    fetchDirectRetail();
    return () => {
      mounted = false;
    };
  }, [growthParams]);

  useEffect(() => {
    let mounted = true;

    const applyValues = (values: Record<string, number>) => {
      if (!mounted) return;
      setDealerAccOtbByBrand({
        MLB: (Number(values.MLB) || 0) * 1000,
        'MLB KIDS': (Number(values['MLB KIDS']) || 0) * 1000,
        DISCOVERY: (Number(values.DISCOVERY) || 0) * 1000,
      });
    };

    const readDealerAccSellIn = (payload?: unknown) => {
      if (typeof window === 'undefined') return false;
      const source = payload ?? window.localStorage.getItem(INVENTORY_DEALER_ACC_SELLIN_KEY);
      if (!source) return false;
      try {
        const parsed = (typeof source === 'string' ? JSON.parse(source) : source) as DealerAccSellInPayload;
        const values = parsed.values ?? {};
        if (Object.values(values).some((v) => Number(v) > 0)) {
          applyValues(values as Record<string, number>);
          return true;
        }
      } catch {
        // ignore malformed payload
      }
      return false;
    };

    const hasLocal = readDealerAccSellIn();
    if (!hasLocal) {
      // localStorage에 값 없으면 서버 파일에서 fallback 조회
      fetch('/api/pl-forecast/dealer-acc-otb', { cache: 'no-store' })
        .then((r) => r.json())
        .then((json: { values?: Record<string, number> }) => {
          if (!mounted) return;
          const values = json.values ?? {};
          if (Object.values(values).some((v) => Number(v) > 0)) {
            applyValues(values);
          }
        })
        .catch(() => {});
    }

    const handleUpdate = (event: Event) => {
      readDealerAccSellIn((event as CustomEvent).detail);
    };

    window.addEventListener('inventory-dealer-acc-sellin-updated', handleUpdate as EventListener);
    window.addEventListener('storage', () => readDealerAccSellIn());
    return () => {
      mounted = false;
      window.removeEventListener('inventory-dealer-acc-sellin-updated', handleUpdate as EventListener);
      window.removeEventListener('storage', () => readDealerAccSellIn());
    };
  }, []);

  const calculatedByBrand = useMemo(() => {
    const result: Record<ForecastLeafBrand, CalculatedSeries> = {
      mlb: deriveCalculated(monthlyInputs.mlb, ANNUAL_2025_RAW_BY_BRAND.mlb, financialAdjust26, financialAdjust25),
      kids: deriveCalculated(monthlyInputs.kids, ANNUAL_2025_RAW_BY_BRAND.kids),
      discovery: deriveCalculated(monthlyInputs.discovery, ANNUAL_2025_RAW_BY_BRAND.discovery),
    };
    return result;
  }, [monthlyInputs, financialAdjust26, financialAdjust25]);

  const corporateCalculated = useMemo(() => {
    const corporateRawMonthly: Record<string, (number | null)[]> = {};
    for (const account of RAW_ACCOUNTS) {
      corporateRawMonthly[account] = makeMonthlyArray((idx) => {
        const v1 = monthlyInputs.mlb[account]?.[idx] ?? null;
        const v2 = monthlyInputs.kids[account]?.[idx] ?? null;
        const v3 = monthlyInputs.discovery[account]?.[idx] ?? null;
        if (v1 === null && v2 === null && v3 === null) return null;
        return (v1 ?? 0) + (v2 ?? 0) + (v3 ?? 0);
      });
    }

    const annualRaw: Record<string, number> = {};
    for (const account of RAW_ACCOUNTS) {
      annualRaw[account] =
        (ANNUAL_2025_RAW_BY_BRAND.mlb[account] ?? 0) +
        (ANNUAL_2025_RAW_BY_BRAND.kids[account] ?? 0) +
        (ANNUAL_2025_RAW_BY_BRAND.discovery[account] ?? 0);
    }

    return deriveCalculated(corporateRawMonthly, annualRaw, financialAdjust26, financialAdjust25);
  }, [monthlyInputs, financialAdjust26, financialAdjust25]);

  const ADJUST_ROW_ACCOUNTS = new Set([
    '재무&관리차이(-)', ...FINANCIAL_ADJUST_ACCOUNTS, '영업이익(재무식)', '영업이익률(재무식)',
  ]);
  const rowDefs = useMemo(() => {
    const base = activeBrand === null ? ROWS_CORPORATE : ROWS_BRAND;
    // 재무조정 행은 법인 또는 MLB일 때만 표시
    if (activeBrand === null || activeBrand === 'mlb') return base;
    return base.filter((r) => !ADJUST_ROW_ACCOUNTS.has(r.account));
  }, [activeBrand]);

  const SCENARIO_SUMMARY_ACCOUNTS = ['리테일매출', '실판매출(V+)', '영업이익(관리식)', '영업이익률(관리식)', '영업이익(재무식)', '영업이익률(재무식)'];

  // 시나리오 모달: 계층구조 접기/펼치기 적용한 visible rows
  const scenarioVisibleRows = useMemo(() => {
    if (scenarioViewMode === 'summary') {
      const defs = scenarioModalBrand === null ? ROWS_CORPORATE : ROWS_BRAND;
      return defs.filter((row) => SCENARIO_SUMMARY_ACCOUNTS.includes(row.account)).map((row) => ({ ...row, isGroup: false }));
    }
    const defs = scenarioModalBrand === null ? ROWS_CORPORATE : ROWS_BRAND;
    const rows: ForecastRowDef[] = [];
    let skipUntilLevel = -1;
    for (const row of defs) {
      if (skipUntilLevel >= 0 && row.level > skipUntilLevel) continue;
      skipUntilLevel = -1;
      rows.push(row);
      if (row.isGroup && scenarioCollapsedAccounts.has(row.account)) skipUntilLevel = row.level;
    }
    return rows;
  }, [scenarioModalBrand, scenarioCollapsedAccounts, scenarioViewMode]);

  const visibleRows = useMemo(() => {
    const rows: ForecastRowDef[] = [];
    let skipUntilLevel = -1;

    for (const row of rowDefs) {
      if (skipUntilLevel >= 0 && row.level > skipUntilLevel) {
        continue;
      }
      skipUntilLevel = -1;
      rows.push(row);
      if (row.isGroup && collapsed.has(row.account)) {
        skipUntilLevel = row.level;
      }
    }

    return rows;
  }, [rowDefs, collapsed]);

  const hasAnyExpanded = useMemo(
    () => rowDefs.some((row) => row.isGroup && !collapsed.has(row.account)),
    [rowDefs, collapsed],
  );

  const getRowSeries = (account: string): { monthly: (number | null)[]; annual2025: number | null } => {
    if (activeBrand === null) {
      if (account === '리테일매출') {
        const total25 = (['MLB', 'MLB KIDS', 'DISCOVERY'] as SalesBrand[]).reduce((s, b) => s + RETAIL_ANNUAL_2025[b].dealer + RETAIL_ANNUAL_2025[b].direct, 0);
        return { monthly: corporateRetail.total, annual2025: total25 };
      }
      if (account === '리테일매출_대리상') {
        const dealer25 = (['MLB', 'MLB KIDS', 'DISCOVERY'] as SalesBrand[]).reduce((s, b) => s + RETAIL_ANNUAL_2025[b].dealer, 0);
        return { monthly: corporateRetail.dealer, annual2025: dealer25 };
      }
      if (account === '리테일매출_직영') {
        const direct25 = (['MLB', 'MLB KIDS', 'DISCOVERY'] as SalesBrand[]).reduce((s, b) => s + RETAIL_ANNUAL_2025[b].direct, 0);
        return { monthly: corporateRetail.direct, annual2025: direct25 };
      }
      if (account === 'Tag매출') {
        return {
          monthly: corporateTagSalesMonthly,
          annual2025: corporateCalculated.annual2025['Tag매출'] ?? null,
        };
      }
      if (account === 'Tag매출_대리상') {
        return {
          monthly: corporateSalesChannel.dealer,
          annual2025: null,
        };
      }
      if (account === 'Tag매출_의류') {
        return {
          monthly: corporateSalesChannel.dealerCloth,
          annual2025: null,
        };
      }
      if (account === 'Tag매출_ACC') {
        return {
          monthly: corporateSalesChannel.dealerAcc,
          annual2025: null,
        };
      }
      if (account === 'Tag매출_직영') {
        return {
          monthly: corporateSalesChannel.direct,
          annual2025: null,
        };
      }
      if (account === '실판매출(V+)') {
        const vMinus = corporateActualSalesChannel.total;
        const annual25vMinus = corporateCalculated.annual2025['실판매출'] ?? null;
        return {
          monthly: vMinus.map((v) => (v === null ? null : v * 1.13)),
          annual2025: annual25vMinus === null ? null : annual25vMinus * 1.13,
        };
      }
      if (account === '실판매출') {
        return {
          monthly: corporateActualSalesChannel.total,
          annual2025: corporateCalculated.annual2025['실판매출'] ?? null,
        };
      }
      if (account === '실판매출_대리상') {
        return {
          monthly: corporateActualSalesChannel.dealer,
          annual2025: null,
        };
      }
      if (account === '실판매출_의류') {
        return {
          monthly: corporateActualSalesChannel.dealerCloth,
          annual2025: null,
        };
      }
      if (account === '실판매출_ACC') {
        return {
          monthly: corporateActualSalesChannel.dealerAcc,
          annual2025: null,
        };
      }
      if (account === '실판매출_직영') {
        return {
          monthly: corporateActualSalesChannel.direct,
          annual2025: null,
        };
      }

      return {
        monthly: corporateCalculated.monthly[account] ?? new Array(12).fill(null),
        annual2025: corporateCalculated.annual2025[account] ?? null,
      };
    }

    const brandKey = activeBrand as ForecastLeafBrand;
    const salesBrand = FORECAST_TO_SALES_BRAND[brandKey];
    if (account === '리테일매출') {
      const r = RETAIL_ANNUAL_2025[salesBrand];
      return { monthly: retailByBrand[salesBrand].total, annual2025: r.dealer + r.direct };
    }
    if (account === '리테일매출_대리상') return { monthly: retailByBrand[salesBrand].dealer, annual2025: RETAIL_ANNUAL_2025[salesBrand].dealer };
    if (account === '리테일매출_직영') return { monthly: retailByBrand[salesBrand].direct, annual2025: RETAIL_ANNUAL_2025[salesBrand].direct };
    if (account === 'Tag매출') {
      return {
        monthly: tagSalesMonthlyByBrand[salesBrand],
        annual2025: calculatedByBrand[brandKey].annual2025['Tag매출'] ?? null,
      };
    }
    if (account === 'Tag매출_대리상') {
      return { monthly: salesChannelByBrand[salesBrand].dealer, annual2025: null };
    }
    if (account === 'Tag매출_의류') {
      return { monthly: salesChannelByBrand[salesBrand].dealerCloth, annual2025: null };
    }
    if (account === 'Tag매출_ACC') {
      return { monthly: salesChannelByBrand[salesBrand].dealerAcc, annual2025: null };
    }
    if (account === 'Tag매출_직영') {
      return { monthly: salesChannelByBrand[salesBrand].direct, annual2025: null };
    }
    if (account === '실판매출(V+)') {
      const vMinus = salesActualByBrand[salesBrand].total;
      const annual25vMinus = calculatedByBrand[brandKey].annual2025['실판매출'] ?? null;
      return {
        monthly: vMinus.map((v) => (v === null ? null : v * 1.13)),
        annual2025: annual25vMinus === null ? null : annual25vMinus * 1.13,
      };
    }
    if (account === '실판매출') {
      return {
        monthly: salesActualByBrand[salesBrand].total,
        annual2025: calculatedByBrand[brandKey].annual2025['실판매출'] ?? null,
      };
    }
    if (account === '실판매출_대리상') {
      return { monthly: salesActualByBrand[salesBrand].dealer, annual2025: null };
    }
    if (account === '실판매출_의류') {
      return { monthly: salesActualByBrand[salesBrand].dealerCloth, annual2025: null };
    }
    if (account === '실판매출_ACC') {
      return { monthly: salesActualByBrand[salesBrand].dealerAcc, annual2025: null };
    }
    if (account === '실판매출_직영') {
      return { monthly: salesActualByBrand[salesBrand].direct, annual2025: null };
    }
    return {
      monthly: calculatedByBrand[brandKey].monthly[account] ?? new Array(12).fill(null),
      annual2025: calculatedByBrand[brandKey].annual2025[account] ?? null,
    };
  };

  const getAnnual26Value = (account: string): number | null => {
    if (account === '영업이익률(관리식)') {
      const annualOi = sumOrNull(getRowSeries('영업이익(관리식)').monthly);
      const annualSales = sumOrNull(getRowSeries('실판매출').monthly);
      if (annualOi === null || annualSales === null || annualSales === 0) return null;
      return annualOi / annualSales;
    }

    if (account === '영업이익률(재무식)') {
      const annualOiF = sumOrNull(getRowSeries('영업이익(재무식)').monthly);
      const annualSales = sumOrNull(getRowSeries('실판매출').monthly);
      if (annualOiF === null || annualSales === null || annualSales === 0) return null;
      return annualOiF / annualSales;
    }

    if (account === '(Tag 대비 원가율)') {
      const annualTag = sumOrNull(getRowSeries('Tag매출').monthly);
      const annualCogs = sumOrNull(getRowSeries('매출원가').monthly);
      if (annualTag === null || annualTag === 0 || annualCogs === null) return null;
      return (annualCogs * 1.13) / annualTag;
    }

    if (account === '실판매출(V+)') {
      const annualVMinus = sumOrNull(getRowSeries('실판매출').monthly);
      return annualVMinus === null ? null : annualVMinus * 1.13;
    }

    return sumOrNull(getRowSeries(account).monthly);
  };

  const updateInput = (brand: ForecastLeafBrand, account: string, monthIndex: number, raw: string) => {
    setMonthlyInputs((prev) => {
      const next = { ...prev, [brand]: { ...prev[brand] } };
      const nextArr = [...(next[brand][account] ?? new Array(12).fill(null))];
      if (raw.trim() === '') {
        nextArr[monthIndex] = null;
      } else {
        const parsed = Number(raw.replace(/,/g, ''));
        // PL table input unit is CNY K; internal calculations use base CNY.
        nextArr[monthIndex] = Number.isFinite(parsed) ? parsed * 1000 : nextArr[monthIndex];
      }
      next[brand][account] = nextArr;
      return next;
    });
  };

  const renderMonthInput = (row: ForecastRowDef, monthIndex: number) => {
    if (activeBrand === null) {
      return <span>{formatValue(getRowSeries(row.account).monthly[monthIndex], row.format)}</span>;
    }

    const brandKey = activeBrand as ForecastLeafBrand;
    const editable = RAW_ACCOUNTS.includes(row.account) && !row.isGroup && !row.isCalculated;
    const isActualLockedMonth = monthIndex === 0; // 1월은 실적월로 고정

    if (!editable || isActualLockedMonth) {
      return <span>{formatValue(getRowSeries(row.account).monthly[monthIndex], row.format)}</span>;
    }

    const value = monthlyInputs[brandKey][row.account]?.[monthIndex] ?? null;
    return (
      <input
        type="text"
        inputMode="numeric"
        value={value === null ? '' : String(Math.round(value / 1000))}
        onChange={(e) => updateInput(brandKey, row.account, monthIndex, e.target.value)}
        className="w-full rounded-md border border-transparent bg-white/80 px-1.5 py-1 text-right outline-none transition-all focus:border-sky-400 focus:bg-white focus:ring-2 focus:ring-sky-100"
      />
    );
  };

  const salesRows = useMemo(() => makeSalesRows(), []);

  const otbByBrand = useMemo(() => {
    const result: Record<SalesBrand, { currS: number; currF: number; year1: number; next: number; total: number }> = {
      MLB: { currS: 0, currF: 0, year1: 0, next: 0, total: 0 },
      'MLB KIDS': { currS: 0, currF: 0, year1: 0, next: 0, total: 0 },
      DISCOVERY: { currS: 0, currF: 0, year1: 0, next: 0, total: 0 },
    };

    for (const brand of SALES_BRANDS) {
      const currF = otbData?.['26F']?.[brand] ?? 0;
      const currS = otbData?.['26S']?.[brand] ?? 0;
      const year1 = otbData?.['25F']?.[brand] ?? 0;
      const next = (otbData?.['27F']?.[brand] ?? 0) + (otbData?.['27S']?.[brand] ?? 0);
      result[brand] = { currS, currF, year1, next, total: currS + currF + year1 + next };
    }
    return result;
  }, [otbData]);

  const dealerSeasonMonthlyByBrand = useMemo(() => {
    const baseline: Record<SalesBrand, Record<SalesSeason, (number | null)[]>> = {
      MLB: { 당년S: new Array(12).fill(0), 당년F: new Array(12).fill(0), '1년차': new Array(12).fill(0), 차기시즌: new Array(12).fill(0) },
      'MLB KIDS': { 당년S: new Array(12).fill(0), 당년F: new Array(12).fill(0), '1년차': new Array(12).fill(0), 차기시즌: new Array(12).fill(0) },
      DISCOVERY: { 당년S: new Array(12).fill(0), 당년F: new Array(12).fill(0), '1년차': new Array(12).fill(0), 차기시즌: new Array(12).fill(0) },
    };

    const progressMap = new Map<string, ShipmentProgressRow>();
    for (const row of shipmentProgressRows) {
      progressMap.set(`${row.brand}::${row.season}`, row);
    }

    for (const brand of SALES_BRANDS) {
      for (const season of DEALER_CLOTH_SEASONS) {
        const progress = progressMap.get(`${brand}::${season}`);
        const otb =
          season === '당년S'
            ? otbByBrand[brand].currS
            : season === '당년F'
              ? otbByBrand[brand].currF
              : season === '1년차'
                ? otbByBrand[brand].year1
                : otbByBrand[brand].next;
        let prevCumulative = progress?.prevYearProgress ?? 0;
        const monthlyAmounts: (number | null)[] = new Array(12).fill(0);

        for (let i = 0; i < 12; i++) {
          const currentCumulative = progress?.monthly[i] ?? prevCumulative;
          const monthlyRate = Math.max(currentCumulative - prevCumulative, 0);
          monthlyAmounts[i] = otb * monthlyRate;
          prevCumulative = currentCumulative;
        }
        baseline[brand][season] = monthlyAmounts;
      }
    }

    const actualCutoffMonth =
      salesSupportActualAvailableMonths.length === 0 ? 0 : Math.max(...salesSupportActualAvailableMonths);
    if (actualCutoffMonth <= 0) return baseline;

    const result: Record<SalesBrand, Record<SalesSeason, (number | null)[]>> = {
      MLB: { 당년S: new Array(12).fill(0), 당년F: new Array(12).fill(0), '1년차': new Array(12).fill(0), 차기시즌: new Array(12).fill(0) },
      'MLB KIDS': { 당년S: new Array(12).fill(0), 당년F: new Array(12).fill(0), '1년차': new Array(12).fill(0), 차기시즌: new Array(12).fill(0) },
      DISCOVERY: { 당년S: new Array(12).fill(0), 당년F: new Array(12).fill(0), '1년차': new Array(12).fill(0), 차기시즌: new Array(12).fill(0) },
    };

    for (const brand of SALES_BRANDS) {
      const seasonActual = salesSupportActualByBrand[brand] ?? {
        당년S: new Array(12).fill(null),
        당년F: new Array(12).fill(null),
        '1년차': new Array(12).fill(null),
        차기시즌: new Array(12).fill(null),
        ACC: new Array(12).fill(null),
      };

      const fixedS = new Array(12).fill(0) as (number | null)[];
      const fixedF = new Array(12).fill(0) as (number | null)[];
      const fixedY1 = new Array(12).fill(0) as (number | null)[];
      const fixedNext = new Array(12).fill(0) as (number | null)[];
      for (let i = 0; i < actualCutoffMonth; i += 1) {
        if (seasonActual.당년S[i] !== null) fixedS[i] = seasonActual.당년S[i];
        if (seasonActual.당년F[i] !== null) fixedF[i] = seasonActual.당년F[i];
        if (seasonActual['1년차'][i] !== null) fixedY1[i] = seasonActual['1년차'][i];
        if (seasonActual.차기시즌[i] !== null) fixedNext[i] = seasonActual.차기시즌[i];
      }

      result[brand].당년S = distributeRemainingByPattern(
        otbByBrand[brand].currS,
        fixedS,
        baseline[brand].당년S,
        actualCutoffMonth,
      );
      result[brand].당년F = distributeRemainingByPattern(
        otbByBrand[brand].currF,
        fixedF,
        baseline[brand].당년F,
        actualCutoffMonth,
      );
      result[brand]['1년차'] = distributeRemainingByPattern(
        otbByBrand[brand].year1,
        fixedY1,
        baseline[brand].당년F,
        actualCutoffMonth,
      );
      result[brand].차기시즌 = distributeRemainingByPattern(
        otbByBrand[brand].next,
        fixedNext,
        new Array(12).fill(0),
        actualCutoffMonth,
        [10, 11],
      );
    }

    return result;
  }, [shipmentProgressRows, otbByBrand, salesSupportActualByBrand, salesSupportActualAvailableMonths]);

  const accRatioByBrand = useMemo(() => {
    const map: Record<SalesBrand, (number | null)[]> = {
      MLB: new Array(12).fill(null),
      'MLB KIDS': new Array(12).fill(null),
      DISCOVERY: new Array(12).fill(null),
    };
    for (const row of accRatioRows) {
      map[row.brand] = row.monthly;
    }
    return map;
  }, [accRatioRows]);

  const salesDerived = useMemo(() => {
    const rowMap: Record<string, { monthly: (number | null)[]; fy26: number | null; otb: number | null }> = {};

    for (const row of salesRows) {
      if (!row.isGroup && row.leafKind) {
        const latestBrandActualMonth = brandActualAvailableMonths.length === 0 ? 0 : Math.max(...brandActualAvailableMonths);
        const latestSupportActualMonth = salesSupportActualAvailableMonths.length === 0 ? 0 : Math.max(...salesSupportActualAvailableMonths);
        const monthly =
          row.leafKind === 'dealerCurrS'
            ? dealerSeasonMonthlyByBrand[row.brand].당년S
            : row.leafKind === 'dealerCurrF'
              ? dealerSeasonMonthlyByBrand[row.brand].당년F
              : row.leafKind === 'dealerYear1'
                ? dealerSeasonMonthlyByBrand[row.brand]['1년차']
                : row.leafKind === 'dealerNext'
                  ? dealerSeasonMonthlyByBrand[row.brand].차기시즌
              : row.leafKind === 'dealerAcc'
                ? (() => {
                    const brand = row.brand;
                    const annualOtb = dealerAccOtbByBrand[brand];
                    const actualSeries = salesSupportActualByBrand[brand]?.ACC ?? new Array(12).fill(null);
                    let actualSum = 0;
                    for (let i = 0; i < latestSupportActualMonth; i++) {
                      actualSum += actualSeries[i] ?? 0;
                    }
                    const remaining = annualOtb - actualSum;
                    let remainingRatioSum = 0;
                    for (let i = latestSupportActualMonth; i < 12; i++) {
                      remainingRatioSum += accRatioByBrand[brand][i] ?? 0;
                    }
                    return makeMonthlyArray((idx) => {
                      if (idx < latestSupportActualMonth) {
                        return actualSeries[idx] ?? 0;
                      }
                      const ratio = accRatioByBrand[brand][idx] ?? 0;
                      if (remainingRatioSum === 0) return annualOtb * ratio;
                      return remaining * (ratio / remainingRatioSum);
                    });
                  })()
                : row.leafKind === 'direct'
                ? makeMonthlyArray((idx) => {
                    if (idx + 1 <= latestBrandActualMonth) return null;
                    return directRetailByBrand[row.brand]?.[idx] ?? null;
                  })
                : new Array(12).fill(null);
        rowMap[row.id] = {
          monthly,
          fy26: sumOrNull(monthly),
          otb:
            row.leafKind === 'dealerCurrS'
              ? otbByBrand[row.brand].currS
              : row.leafKind === 'dealerCurrF'
                ? otbByBrand[row.brand].currF
                : row.leafKind === 'dealerYear1'
                  ? otbByBrand[row.brand].year1
                  : row.leafKind === 'dealerNext'
                    ? otbByBrand[row.brand].next
                : row.leafKind === 'dealerAcc'
                  ? dealerAccOtbByBrand[row.brand]
                  : null,
        };
      }
    }

    for (const brand of SALES_BRANDS) {
      const dealerS = rowMap[`dealerS:${brand}`]?.monthly ?? new Array(12).fill(null);
      const dealerF = rowMap[`dealerF:${brand}`]?.monthly ?? new Array(12).fill(null);
      const dealerYear1 = rowMap[`dealerYear1:${brand}`]?.monthly ?? new Array(12).fill(null);
      const dealerNext = rowMap[`dealerNext:${brand}`]?.monthly ?? new Array(12).fill(null);
      const dealerClothingTotal = sumSeries(sumSeries(dealerS, dealerF), sumSeries(dealerYear1, dealerNext));
      rowMap[`dealerCloth:${brand}`] = {
        monthly: dealerClothingTotal,
        fy26: sumOrNull(dealerClothingTotal),
        otb: otbByBrand[brand].total,
      };

      const dealerAcc = rowMap[`dealerACC:${brand}`]?.monthly ?? new Array(12).fill(null);
      const direct = rowMap[`direct:${brand}`]?.monthly ?? new Array(12).fill(null);
      const brandTotal = sumSeries(sumSeries(dealerClothingTotal, dealerAcc), direct);
      rowMap[`brand:${brand}`] = {
        monthly: brandTotal,
        fy26: sumOrNull(brandTotal),
        otb: null,
      };
    }

    return rowMap;
  }, [salesRows, otbByBrand, directRetailByBrand, dealerSeasonMonthlyByBrand, dealerAccOtbByBrand, accRatioByBrand, brandActualAvailableMonths, salesSupportActualByBrand, salesSupportActualAvailableMonths]);

  const salesChannelByBrand = useMemo(() => {
    const buildEmpty = () => new Array(12).fill(null) as (number | null)[];
    const supportActualCutoff =
      salesSupportActualAvailableMonths.length === 0 ? 0 : Math.max(...salesSupportActualAvailableMonths);
    const result: Record<SalesBrand, { dealerCloth: (number | null)[]; dealerAcc: (number | null)[]; dealer: (number | null)[]; direct: (number | null)[] }> = {
      MLB: { dealerCloth: buildEmpty(), dealerAcc: buildEmpty(), dealer: buildEmpty(), direct: buildEmpty() },
      'MLB KIDS': { dealerCloth: buildEmpty(), dealerAcc: buildEmpty(), dealer: buildEmpty(), direct: buildEmpty() },
      DISCOVERY: { dealerCloth: buildEmpty(), dealerAcc: buildEmpty(), dealer: buildEmpty(), direct: buildEmpty() },
    };
    for (const brand of SALES_BRANDS) {
      const plannedDealerCloth = salesDerived[`dealerCloth:${brand}`]?.monthly ?? buildEmpty();
      const plannedDealerAcc = salesDerived[`dealerACC:${brand}`]?.monthly ?? buildEmpty();
      const plannedDealer = sumSeries(plannedDealerCloth, plannedDealerAcc);
      const plannedDirect = salesDerived[`direct:${brand}`]?.monthly ?? buildEmpty();

      const dealerCloth = buildEmpty();
      const dealerAcc = buildEmpty();
      const dealer = buildEmpty();
      const direct = buildEmpty();
      const supportActual = salesSupportActualByBrand[brand] ?? {
        당년S: buildEmpty(),
        당년F: buildEmpty(),
        '1년차': buildEmpty(),
        차기시즌: buildEmpty(),
        ACC: buildEmpty(),
      };
      for (let i = 0; i < 12; i += 1) {
        const actualDealer = brandActualByBrand[brand]?.tag?.dealer?.[i] ?? null;
        const actualDirect = brandActualByBrand[brand]?.tag?.direct?.[i] ?? null;
        const supportActualClothRaw = [supportActual.당년S[i], supportActual.당년F[i], supportActual['1년차'][i], supportActual.차기시즌[i]];
        const supportActualCloth =
          supportActualClothRaw.some((v) => v !== null)
            ? supportActualClothRaw.reduce<number>((sum, v) => sum + (v ?? 0), 0)
            : null;
        const supportActualAcc = supportActual.ACC[i] ?? null;
        const actualDealerCloth =
          i < supportActualCutoff
            ? supportActualCloth ?? (brandActualByBrand[brand]?.tag?.dealerCloth?.[i] ?? null)
            : brandActualByBrand[brand]?.tag?.dealerCloth?.[i] ?? null;
        const actualDealerAcc =
          i < supportActualCutoff
            ? supportActualAcc ?? (brandActualByBrand[brand]?.tag?.dealerAcc?.[i] ?? null)
            : brandActualByBrand[brand]?.tag?.dealerAcc?.[i] ?? null;

        const dealerValue = actualDealer ?? plannedDealer[i] ?? null;
        const directValue = actualDirect ?? plannedDirect[i] ?? null;

        dealer[i] = dealerValue;
        direct[i] = directValue;

        if (actualDealerCloth !== null || actualDealerAcc !== null) {
          dealerCloth[i] = actualDealerCloth ?? 0;
          dealerAcc[i] = actualDealerAcc ?? 0;
        } else {
          const split = splitByPlannedRatio(dealerValue, plannedDealerCloth[i] ?? null, plannedDealerAcc[i] ?? null);
          dealerCloth[i] = split.a;
          dealerAcc[i] = split.b;
        }
      }
      result[brand] = {
        dealerCloth,
        dealerAcc,
        dealer,
        direct,
      };
    }
    return result;
  }, [salesDerived, brandActualByBrand, salesSupportActualByBrand, salesSupportActualAvailableMonths]);

  const corporateSalesChannel = useMemo(() => {
    return {
      dealerCloth: sumSeries(
        sumSeries(salesChannelByBrand.MLB.dealerCloth, salesChannelByBrand['MLB KIDS'].dealerCloth),
        salesChannelByBrand.DISCOVERY.dealerCloth,
      ),
      dealerAcc: sumSeries(
        sumSeries(salesChannelByBrand.MLB.dealerAcc, salesChannelByBrand['MLB KIDS'].dealerAcc),
        salesChannelByBrand.DISCOVERY.dealerAcc,
      ),
      dealer: sumSeries(sumSeries(salesChannelByBrand.MLB.dealer, salesChannelByBrand['MLB KIDS'].dealer), salesChannelByBrand.DISCOVERY.dealer),
      direct: sumSeries(sumSeries(salesChannelByBrand.MLB.direct, salesChannelByBrand['MLB KIDS'].direct), salesChannelByBrand.DISCOVERY.direct),
    };
  }, [salesChannelByBrand]);

  const tagSalesMonthlyByBrand = useMemo(() => {
    return {
      MLB: sumSeries(salesChannelByBrand.MLB.dealer, salesChannelByBrand.MLB.direct),
      'MLB KIDS': sumSeries(salesChannelByBrand['MLB KIDS'].dealer, salesChannelByBrand['MLB KIDS'].direct),
      DISCOVERY: sumSeries(salesChannelByBrand.DISCOVERY.dealer, salesChannelByBrand.DISCOVERY.direct),
    } as Record<SalesBrand, (number | null)[]>;
  }, [salesChannelByBrand]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const values = {
      MLB: (() => {
        const annualTag = sumOrNull(tagSalesMonthlyByBrand.MLB);
        const annualCogs = sumOrNull(calculatedByBrand.mlb.monthly['매출원가'] ?? new Array(12).fill(null));
        if (annualTag === null || annualTag === 0 || annualCogs === null) return null;
        return (annualCogs * 1.13) / annualTag;
      })(),
      'MLB KIDS': (() => {
        const annualTag = sumOrNull(tagSalesMonthlyByBrand['MLB KIDS']);
        const annualCogs = sumOrNull(calculatedByBrand.kids.monthly['매출원가'] ?? new Array(12).fill(null));
        if (annualTag === null || annualTag === 0 || annualCogs === null) return null;
        return (annualCogs * 1.13) / annualTag;
      })(),
      DISCOVERY: (() => {
        const annualTag = sumOrNull(tagSalesMonthlyByBrand.DISCOVERY);
        const annualCogs = sumOrNull(calculatedByBrand.discovery.monthly['매출원가'] ?? new Array(12).fill(null));
        if (annualTag === null || annualTag === 0 || annualCogs === null) return null;
        return (annualCogs * 1.13) / annualTag;
      })(),
    };

    if (values.MLB == null && values['MLB KIDS'] == null && values.DISCOVERY == null) return;
    const payload = { values };
    window.localStorage.setItem(PL_TAG_COST_RATIO_KEY, JSON.stringify(payload));
    window.dispatchEvent(new CustomEvent('pl-tag-cost-ratio-updated', { detail: payload }));
  }, [calculatedByBrand, tagSalesMonthlyByBrand]);

  const corporateTagSalesMonthly = useMemo(() => {
    return sumSeries(sumSeries(tagSalesMonthlyByBrand.MLB, tagSalesMonthlyByBrand['MLB KIDS']), tagSalesMonthlyByBrand.DISCOVERY);
  }, [tagSalesMonthlyByBrand]);

  const salesActualByBrand = useMemo(() => {
    const buildEmpty = () => new Array(12).fill(null) as (number | null)[];
    const result: Record<SalesBrand, { dealerCloth: (number | null)[]; dealerAcc: (number | null)[]; dealer: (number | null)[]; direct: (number | null)[]; total: (number | null)[] }> = {
      MLB: { dealerCloth: buildEmpty(), dealerAcc: buildEmpty(), dealer: buildEmpty(), direct: buildEmpty(), total: buildEmpty() },
      'MLB KIDS': { dealerCloth: buildEmpty(), dealerAcc: buildEmpty(), dealer: buildEmpty(), direct: buildEmpty(), total: buildEmpty() },
      DISCOVERY: { dealerCloth: buildEmpty(), dealerAcc: buildEmpty(), dealer: buildEmpty(), direct: buildEmpty(), total: buildEmpty() },
    };
    for (const brand of SALES_BRANDS) {
      const plannedDealerCloth = applyRate(salesChannelByBrand[brand].dealerCloth, SHIPMENT_RATE_PERCENT_BY_CHANNEL.dealerCloth[brand]);
      const plannedDealerAcc = applyRate(salesChannelByBrand[brand].dealerAcc, SHIPMENT_RATE_PERCENT_BY_CHANNEL.dealerAcc[brand]);
      const plannedDealer = sumSeries(plannedDealerCloth, plannedDealerAcc);
      const plannedDirect = applyRate(salesChannelByBrand[brand].direct, SHIPMENT_RATE_PERCENT_BY_CHANNEL.direct[brand]);

      const dealerCloth = buildEmpty();
      const dealerAcc = buildEmpty();
      const dealer = buildEmpty();
      const direct = buildEmpty();
      for (let i = 0; i < 12; i += 1) {
        const actualDealer = brandActualByBrand[brand]?.sales?.dealer?.[i] ?? null;
        const actualDirect = brandActualByBrand[brand]?.sales?.direct?.[i] ?? null;
        const actualDealerCloth = brandActualByBrand[brand]?.sales?.dealerCloth?.[i] ?? null;
        const actualDealerAcc = brandActualByBrand[brand]?.sales?.dealerAcc?.[i] ?? null;

        const dealerValue = actualDealer ?? plannedDealer[i] ?? null;
        const directValue = actualDirect ?? plannedDirect[i] ?? null;

        dealer[i] = dealerValue;
        direct[i] = directValue;

        if (actualDealerCloth !== null || actualDealerAcc !== null) {
          dealerCloth[i] = actualDealerCloth ?? 0;
          dealerAcc[i] = actualDealerAcc ?? 0;
        } else {
          const split = splitByPlannedRatio(dealerValue, plannedDealerCloth[i] ?? null, plannedDealerAcc[i] ?? null);
          dealerCloth[i] = split.a;
          dealerAcc[i] = split.b;
        }
      }
      result[brand] = {
        dealerCloth,
        dealerAcc,
        dealer,
        direct,
        total: sumSeries(dealer, direct),
      };
    }
    return result;
  }, [salesChannelByBrand, brandActualByBrand]);

  const corporateActualSalesChannel = useMemo(() => {
    return {
      dealerCloth: sumSeries(
        sumSeries(salesActualByBrand.MLB.dealerCloth, salesActualByBrand['MLB KIDS'].dealerCloth),
        salesActualByBrand.DISCOVERY.dealerCloth,
      ),
      dealerAcc: sumSeries(
        sumSeries(salesActualByBrand.MLB.dealerAcc, salesActualByBrand['MLB KIDS'].dealerAcc),
        salesActualByBrand.DISCOVERY.dealerAcc,
      ),
      dealer: sumSeries(sumSeries(salesActualByBrand.MLB.dealer, salesActualByBrand['MLB KIDS'].dealer), salesActualByBrand.DISCOVERY.dealer),
      direct: sumSeries(sumSeries(salesActualByBrand.MLB.direct, salesActualByBrand['MLB KIDS'].direct), salesActualByBrand.DISCOVERY.direct),
      total: sumSeries(sumSeries(salesActualByBrand.MLB.total, salesActualByBrand['MLB KIDS'].total), salesActualByBrand.DISCOVERY.total),
    };
  }, [salesActualByBrand]);

  // 리테일매출: 실적 CSV에서만 가져옴 (계획 없음)
  const retailByBrand = useMemo(() => {
    const result: Record<SalesBrand, { dealer: (number | null)[]; direct: (number | null)[]; total: (number | null)[] }> = {
      MLB: { dealer: new Array(12).fill(null), direct: new Array(12).fill(null), total: new Array(12).fill(null) },
      'MLB KIDS': { dealer: new Array(12).fill(null), direct: new Array(12).fill(null), total: new Array(12).fill(null) },
      DISCOVERY: { dealer: new Array(12).fill(null), direct: new Array(12).fill(null), total: new Array(12).fill(null) },
    };
    for (const brand of (['MLB', 'MLB KIDS', 'DISCOVERY'] as SalesBrand[])) {
      const actualDealer = brandActualByBrand[brand]?.retail?.dealer ?? new Array(12).fill(null);
      const actualDirect = brandActualByBrand[brand]?.retail?.direct ?? new Array(12).fill(null);
      const tagDealer = dealerTagRetailByBrand[brand] ?? new Array(12).fill(null);
      const tagDirect = directRetailByBrand[brand] ?? new Array(12).fill(null);
      const discountDealer = prevYearDiscountByBrand[brand]?.dealer ?? new Array(12).fill(null);
      const discountDirect = prevYearDiscountByBrand[brand]?.direct ?? new Array(12).fill(null);

      for (let i = 0; i < 12; i++) {
        // 실적월: CSV 실적값, 계획월: Tag리테일 × (1 - 전년할인율)
        const actualD = actualDealer[i];
        const actualH = actualDirect[i];
        result[brand].dealer[i] = actualD !== null
          ? actualD
          : (tagDealer[i] !== null ? tagDealer[i]! * (1 - (discountDealer[i] ?? 0)) : null);
        result[brand].direct[i] = actualH !== null
          ? actualH
          : (tagDirect[i] !== null ? tagDirect[i]! * (1 - (discountDirect[i] ?? 0)) : null);
      }
      result[brand].total = sumSeries(result[brand].dealer, result[brand].direct);
    }
    return result;
  }, [brandActualByBrand, dealerTagRetailByBrand, directRetailByBrand, prevYearDiscountByBrand]);

  const corporateRetail = useMemo(() => ({
    dealer: sumSeries(sumSeries(retailByBrand.MLB.dealer, retailByBrand['MLB KIDS'].dealer), retailByBrand.DISCOVERY.dealer),
    direct: sumSeries(sumSeries(retailByBrand.MLB.direct, retailByBrand['MLB KIDS'].direct), retailByBrand.DISCOVERY.direct),
    total: sumSeries(sumSeries(retailByBrand.MLB.total, retailByBrand['MLB KIDS'].total), retailByBrand.DISCOVERY.total),
  }), [retailByBrand]);

  // 2025년 연간 리테일매출 (하드코딩, K 단위 → 원 단위 *1000)
  const RETAIL_ANNUAL_2025: Record<SalesBrand, { dealer: number; direct: number }> = {
    MLB: { dealer: 7281233.351 * 1000, direct: 1092087.687 * 1000 },
    'MLB KIDS': { dealer: 291298.21 * 1000, direct: 109701.65 * 1000 },
    DISCOVERY: { dealer: 31224.81 * 1000, direct: 24029.47 * 1000 },
  };

  const latestActualMonth = useMemo(() => {
    if (brandActualAvailableMonths.length === 0) return 0;
    return Math.max(...brandActualAvailableMonths);
  }, [brandActualAvailableMonths]);

  useEffect(() => {
    setMonthlyInputs((prev) => {
      let changed = false;
      const next: MonthlyInputs = {
        mlb: { ...prev.mlb },
        kids: { ...prev.kids },
        discovery: { ...prev.discovery },
      };

      (Object.entries(FORECAST_TO_SALES_BRAND) as [ForecastLeafBrand, SalesBrand][]).forEach(([forecastBrand, salesBrand]) => {
        const nextTag = [...tagSalesMonthlyByBrand[salesBrand]];
        const nextActual = [...salesActualByBrand[salesBrand].total];
        const currentTag = prev[forecastBrand]['Tag매출'] ?? new Array(12).fill(null);
        const currentActual = prev[forecastBrand]['실판매출'] ?? new Array(12).fill(null);

        if (!isSameSeries(currentTag, nextTag)) {
          next[forecastBrand]['Tag매출'] = nextTag;
          changed = true;
        }
        if (!isSameSeries(currentActual, nextActual)) {
          next[forecastBrand]['실판매출'] = nextActual;
          changed = true;
        }

        const accountOverrides = brandActualByBrand[salesBrand]?.accounts ?? {};
        for (const [account, overrideSeries] of Object.entries(accountOverrides)) {
          if (!RAW_ACCOUNTS.includes(account) || account === 'Tag매출' || account === '실판매출') continue;
          const current = prev[forecastBrand][account] ?? new Array(12).fill(null);
          const merged = [...current];
          let localChanged = false;
          for (let i = 0; i < 12; i += 1) {
            const v = overrideSeries?.[i] ?? null;
            if (v === null) continue;
            if ((merged[i] ?? null) !== v) {
              merged[i] = v;
              localChanged = true;
            }
          }
          if (localChanged) {
            next[forecastBrand][account] = merged;
            changed = true;
          }
        }

        const tagCostRatioSeries = tagCostRatioByBrand[salesBrand] ?? new Array(12).fill(null);
        const currentCogs = next[forecastBrand]['매출원가'] ?? new Array(12).fill(null);
        const mergedCogs = [...currentCogs];
        let cogsChanged = false;
        for (let i = 0; i < 12; i += 1) {
          if (i + 1 <= latestActualMonth) continue;
          if (accountOverrides['매출원가']?.[i] !== null && accountOverrides['매출원가']?.[i] !== undefined) continue;

          const tag = next[forecastBrand]['Tag매출']?.[i] ?? null;
          const ratio = tagCostRatioSeries[i] ?? null;
          if (tag === null || ratio === null) continue;

          const forecastCogs = (tag / 1.13) * ratio;
          if ((mergedCogs[i] ?? null) !== forecastCogs) {
            mergedCogs[i] = forecastCogs;
            cogsChanged = true;
          }
        }
        if (cogsChanged) {
          next[forecastBrand]['매출원가'] = mergedCogs;
          changed = true;
        }

        const directExpenseRatio = directExpenseRatioByBrand[salesBrand] ?? {};
        const salesSeries = next[forecastBrand]['실판매출'] ?? new Array(12).fill(null);
        for (const account of DIRECT_EXPENSE_ACCOUNTS) {
          const ratioSeries = directExpenseRatio[account];
          if (!ratioSeries) continue;

          const current = next[forecastBrand][account] ?? new Array(12).fill(null);
          const merged = [...current];
          let localChanged = false;
          for (let i = 0; i < 12; i += 1) {
            if (i + 1 <= latestActualMonth) continue;
            if (accountOverrides[account]?.[i] !== null && accountOverrides[account]?.[i] !== undefined) continue;

            const sales = salesSeries[i] ?? null;
            const ratio = ratioSeries[i] ?? null;
            if (ratio === null) continue;
            if (!FIXED_COST_ACCOUNTS.has(account) && sales === null) continue;

            const forecastValue = FIXED_COST_ACCOUNTS.has(account)
              ? ratio
              : sales! * ratio;
            if ((merged[i] ?? null) !== forecastValue) {
              merged[i] = forecastValue;
              localChanged = true;
            }
          }
          if (localChanged) {
            next[forecastBrand][account] = merged;
            changed = true;
          }
        }

        const opexForecast = opexForecastByBrand[salesBrand] ?? {};
        for (const account of OPERATING_EXPENSE_ACCOUNTS) {
          const forecastSeries = opexForecast[account];
          if (!forecastSeries) continue;
          const actualSeries = accountOverrides[account] ?? new Array(12).fill(null);
          const current = next[forecastBrand][account] ?? new Array(12).fill(null);
          const merged = [...current];
          let localChanged = false;
          for (let i = 1; i < 12; i += 1) {
            if (actualSeries[i] !== null && actualSeries[i] !== undefined) continue;
            const fv = forecastSeries[i] ?? null;
            if (fv === null) continue;
            if ((merged[i] ?? null) !== fv) {
              merged[i] = fv;
              localChanged = true;
            }
          }
          if (localChanged) {
            next[forecastBrand][account] = merged;
            changed = true;
          }
        }
      });

      return changed ? next : prev;
    });
  }, [tagSalesMonthlyByBrand, salesActualByBrand, brandActualByBrand, directExpenseRatioByBrand, latestActualMonth, opexForecastByBrand, tagCostRatioByBrand]);

  const visibleSalesRows = useMemo(() => {
    return salesRows.filter((row) => {
      let parent = row.parentId;
      while (parent) {
        if (salesCollapsed.has(parent)) return false;
        parent = salesRows.find((r) => r.id === parent)?.parentId ?? null;
      }
      return true;
    });
  }, [salesRows, salesCollapsed]);

  const shipmentProgressOrderedRows = useMemo(() => {
    const rowMap = new Map<string, ShipmentProgressRow>();
    for (const row of shipmentProgressRows) {
      rowMap.set(`${row.brand}::${row.season}`, row);
    }
    const ordered: ShipmentProgressRow[] = [];
    for (const brand of SALES_BRANDS) {
      for (const season of DEALER_CLOTH_SEASONS) {
        ordered.push(
          rowMap.get(`${brand}::${season}`) ?? {
            brand,
            season,
            prevYearProgress: null,
            monthly: new Array(12).fill(null),
          },
        );
      }
    }
    return ordered;
  }, [shipmentProgressRows]);

  const accRatioOrderedRows = useMemo(() => {
    const rowMap = new Map<string, AccShipmentRatioRow>();
    for (const row of accRatioRows) {
      rowMap.set(row.brand, row);
    }
    return SALES_BRANDS.map((brand) => rowMap.get(brand) ?? { brand, monthly: new Array(12).fill(null) });
  }, [accRatioRows]);

  const formatProgress = (value: number | null): string => {
    if (value === null || Number.isNaN(value)) return '';
    return `${value.toFixed(6)}`.replace(/\.?0+$/, '');
  };

  const formatPercent3 = (value: number | null): string => {
    if (value === null || Number.isNaN(value)) return '';
    return `${(value * 100).toFixed(3)}%`;
  };

  const formatKAmount = (value: number | null): string => {
    if (value === null || !Number.isFinite(value)) return '-';
    return Math.round(value).toLocaleString();
  };

  const loadingStates = [
    otbLoading,
    retailLoading,
    shipmentProgressLoading,
    accRatioLoading,
    brandActualLoading,
    salesSupportActualLoading,
    opexForecastLoading,
    directExpenseRatioLoading,
    tagCostRatioLoading,
  ];
  const totalLoadCount = loadingStates.length;
  const doneLoadCount = loadingStates.filter((v) => !v).length;
  const isLoadingAny = loadingStates.some((v) => v);
  const hasAnyLoadError =
    !!otbError ||
    !!retailError ||
    !!shipmentProgressError ||
    !!accRatioError ||
    !!brandActualError ||
    !!salesSupportActualError ||
    !!opexForecastError ||
    !!directExpenseRatioError ||
    !!tagCostRatioError;

  // ─── 시나리오 모달 헬퍼 함수들 ──────────────────────────────────────────────

  const getScenarioRowSeries = (account: string, brandKey: string | null, result: ScenarioResult): (number | null)[] => {
    // 리테일매출: 시나리오별 성장률 적용된 데이터 (retail 없으면 메인 fallback)
    if (account === '리테일매출' || account === '리테일매출_대리상' || account === '리테일매출_직영') {
      if (brandKey === null) {
        const r = result.corporate.retail;
        if (r) {
          if (account === '리테일매출') return r.total;
          if (account === '리테일매출_대리상') return r.dealer;
          return r.direct;
        }
      } else {
        const r = result.byBrand[brandKey as ForecastLeafBrand]?.retail;
        if (r) {
          if (account === '리테일매출') return r.total;
          if (account === '리테일매출_대리상') return r.dealer;
          return r.direct;
        }
      }
      return getRowSeries(account).monthly;
    }
    if (brandKey === null) {
      const c = result.corporate;
      if (account === 'Tag매출') return c.tagSalesMonthly;
      if (account === 'Tag매출_대리상') return c.salesChannel.dealer;
      if (account === 'Tag매출_의류') return c.salesChannel.dealerCloth;
      if (account === 'Tag매출_ACC') return c.salesChannel.dealerAcc;
      if (account === 'Tag매출_직영') return c.salesChannel.direct;
      if (account === '실판매출(V+)') return c.salesActual.total.map((v) => (v === null ? null : v * 1.13));
      if (account === '실판매출') return c.salesActual.total;
      if (account === '실판매출_대리상') return c.salesActual.dealer;
      if (account === '실판매출_의류') return c.salesActual.dealerCloth;
      if (account === '실판매출_ACC') return c.salesActual.dealerAcc;
      if (account === '실판매출_직영') return c.salesActual.direct;
      return c.calculated.monthly[account] ?? new Array(12).fill(null);
    }
    const fBrand = brandKey as ForecastLeafBrand;
    const bd = result.byBrand[fBrand];
    if (account === 'Tag매출') return bd.tagSalesMonthly;
    if (account === 'Tag매출_대리상') return bd.salesChannel.dealer;
    if (account === 'Tag매출_의류') return bd.salesChannel.dealerCloth;
    if (account === 'Tag매출_ACC') return bd.salesChannel.dealerAcc;
    if (account === 'Tag매출_직영') return bd.salesChannel.direct;
    if (account === '실판매출(V+)') return bd.salesActual.total.map((v) => (v === null ? null : v * 1.13));
    if (account === '실판매출') return bd.salesActual.total;
    if (account === '실판매출_대리상') return bd.salesActual.dealer;
    if (account === '실판매출_의류') return bd.salesActual.dealerCloth;
    if (account === '실판매출_ACC') return bd.salesActual.dealerAcc;
    if (account === '실판매출_직영') return bd.salesActual.direct;
    return bd.calculated.monthly[account] ?? new Array(12).fill(null);
  };

  const getScenarioAnnual26 = (account: string, brandKey: string | null, result: ScenarioResult): number | null => {
    const gs = (acc: string) => getScenarioRowSeries(acc, brandKey, result);
    if (account === '영업이익률(관리식)') {
      const oi = sumOrNull(gs('영업이익(관리식)'));
      const sales = sumOrNull(gs('실판매출'));
      if (oi === null || sales === null || sales === 0) return null;
      return oi / sales;
    }
    if (account === '영업이익률(재무식)') {
      const oiF = sumOrNull(gs('영업이익(재무식)'));
      const sales = sumOrNull(gs('실판매출'));
      if (oiF === null || sales === null || sales === 0) return null;
      return oiF / sales;
    }
    if (account === '(Tag 대비 원가율)') {
      const tag = sumOrNull(gs('Tag매출'));
      const cogs = sumOrNull(gs('매출원가'));
      if (tag === null || tag === 0 || cogs === null) return null;
      return (cogs * 1.13) / tag;
    }
    if (account === '실판매출(V+)') {
      const vMinus = sumOrNull(gs('실판매출'));
      return vMinus === null ? null : vMinus * 1.13;
    }
    return sumOrNull(gs(account));
  };

  const handleDownloadScenarioJson = (scKey: ScenarioKey) => {
    if (!scenarioData) return;
    const def = SCENARIO_DEFS[scKey];
    const fmtG = (r: number) => `${r >= 0 ? '+' : ''}${r}% (전년대비 ${100 + r}%)`;
    const buildRows = (bKey: string | null) => {
      const rDefs = bKey === null ? ROWS_CORPORATE : ROWS_BRAND;
      return rDefs.map((row) => {
        const monthly = getScenarioRowSeries(row.account, bKey, scenarioData[scKey]);
        const annual2025 = (() => {
          if (row.account === '실판매출(V+)') {
            const vMinus = bKey === null
              ? scenarioData[scKey].corporate.calculated.annual2025['실판매출'] ?? null
              : scenarioData[scKey].byBrand[bKey as ForecastLeafBrand].calculated.annual2025['실판매출'] ?? null;
            return vMinus === null ? null : vMinus * 1.13;
          }
          if (row.account === '리테일매출' || row.account === '리테일매출_대리상' || row.account === '리테일매출_직영') {
            if (bKey === null) {
              if (row.account === '리테일매출') return (['MLB', 'MLB KIDS', 'DISCOVERY'] as SalesBrand[]).reduce((s, b) => s + RETAIL_ANNUAL_2025[b].dealer + RETAIL_ANNUAL_2025[b].direct, 0);
              if (row.account === '리테일매출_대리상') return (['MLB', 'MLB KIDS', 'DISCOVERY'] as SalesBrand[]).reduce((s, b) => s + RETAIL_ANNUAL_2025[b].dealer, 0);
              return (['MLB', 'MLB KIDS', 'DISCOVERY'] as SalesBrand[]).reduce((s, b) => s + RETAIL_ANNUAL_2025[b].direct, 0);
            }
            const sb = FORECAST_TO_SALES_BRAND[bKey as ForecastLeafBrand];
            const r25 = RETAIL_ANNUAL_2025[sb];
            if (row.account === '리테일매출') return r25.dealer + r25.direct;
            if (row.account === '리테일매출_대리상') return r25.dealer;
            return r25.direct;
          }
          return bKey === null
            ? scenarioData[scKey].corporate.calculated.annual2025[row.account] ?? null
            : scenarioData[scKey].byBrand[bKey as ForecastLeafBrand].calculated.annual2025[row.account] ?? null;
        })();
        const annual2026 = getScenarioAnnual26(row.account, bKey, scenarioData[scKey]);
        return {
          account: row.account,
          level: row.level,
          isGroup: row.isGroup ?? false,
          format: row.format,
          annual2025: annual2025 !== null ? Math.round(annual2025) : null,
          monthly: monthly.map((v) => (v !== null ? Math.round(v) : null)),
          annual2026: annual2026 !== null ? Math.round(annual2026) : null,
        };
      });
    };
    const data = {
      scenario: def.label,
      growthRates: {
        description: `${def.label} 시나리오 적용 성장률 (FY26 전년대비)`,
        dealer: {
          MLB: fmtG(effectiveScenarioGrowthRates[scKey].dealer.MLB),
          'MLB KIDS': fmtG(effectiveScenarioGrowthRates[scKey].dealer['MLB KIDS']),
          DISCOVERY: fmtG(effectiveScenarioGrowthRates[scKey].dealer.DISCOVERY),
        },
        hq: {
          MLB: fmtG(effectiveScenarioGrowthRates[scKey].hq.MLB),
          'MLB KIDS': fmtG(effectiveScenarioGrowthRates[scKey].hq['MLB KIDS']),
          DISCOVERY: fmtG(effectiveScenarioGrowthRates[scKey].hq.DISCOVERY),
        },
      },
      generatedAt: new Date().toISOString(),
      unit: 'CNY K',
      months: MONTH_HEADERS,
      brands: {
        corporate: { label: '법인', rows: buildRows(null) },
        mlb: { label: 'MLB', rows: buildRows('mlb') },
        kids: { label: 'MLB KIDS', rows: buildRows('kids') },
        discovery: { label: 'DISCOVERY', rows: buildRows('discovery') },
      },
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `PL_FY26_시나리오_${def.label}_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const openScenarioModal = async (force = false) => {
    setScenarioModalOpen(true);

    // 이미 데이터가 있으면 API 재호출 없이 바로 열기 (force=true이면 무시)
    if (!force && scenarioData) return;

    setScenarioData(null);
    setScenarioLoading(true);
    setScenarioError(null);
    setScenarioExpandedScenarios(new Set());
    setScenarioCollapsedAccounts(new Set(['Tag매출', '실판매출', '매출원가 합계', '직접비', '영업비', '재무&관리차이(-)']));
    setScenarioModalBrand(null);

    try {
      // 재고자산(sim)에서 "재계산/저장"으로 확정한 본사리테일 판매 데이터 읽기.
      // 상위 scenarioOverride(메모리)가 있으면 그걸 우선, 없으면 API GET으로 기본값(git 커밋 JSON) 읽음.
      const scenarioRetailHq: Record<ScenarioKey, Record<SalesBrand, (number | null)[]>> = {
        base: { MLB: [], 'MLB KIDS': [], DISCOVERY: [] },
        positive: { MLB: [], 'MLB KIDS': [], DISCOVERY: [] },
        negative: { MLB: [], 'MLB KIDS': [], DISCOVERY: [] },
      };
      const scenarioRetailDealer: Record<ScenarioKey, Record<SalesBrand, (number | null)[]>> = {
        base: { MLB: [], 'MLB KIDS': [], DISCOVERY: [] },
        positive: { MLB: [], 'MLB KIDS': [], DISCOVERY: [] },
        negative: { MLB: [], 'MLB KIDS': [], DISCOVERY: [] },
      };

      type ScenarioInventoryApi = {
        retailHqMonthly?: Record<string, Record<string, (number | null)[]>>;
        retailDealerMonthly?: Record<string, Record<string, (number | null)[]>>;
        closing?: Record<string, Record<string, number>>;
        error?: string;
      };
      let invJson: ScenarioInventoryApi;
      if (scenarioOverride) {
        invJson = {
          retailHqMonthly: scenarioOverride.retailHqMonthly as Record<string, Record<string, (number | null)[]>>,
          retailDealerMonthly: scenarioOverride.retailDealerMonthly as Record<string, Record<string, (number | null)[]>>,
          closing: scenarioOverride.closing as Record<string, Record<string, number>>,
        };
      } else {
        const invRes = await fetch('/api/inventory/scenario-inventory', { cache: 'no-store' });
        if (!invRes.ok) throw new Error('재고자산(sim) 시나리오 데이터가 없습니다. 재고자산(sim) 탭에서 "재계산/저장"을 먼저 실행해주세요.');
        invJson = (await invRes.json()) as ScenarioInventoryApi;
        if (invJson.error) throw new Error(invJson.error);
      }
      if (!invJson.retailHqMonthly) throw new Error('시나리오 본사리테일 데이터가 없습니다. 재고자산(sim) 탭에서 "재계산/저장"을 다시 실행해주세요.');

      for (const scKey of SCENARIO_ORDER) {
        for (const brand of SALES_BRANDS) {
          scenarioRetailHq[scKey][brand] = invJson.retailHqMonthly[scKey]?.[brand] ?? new Array(12).fill(null);
          scenarioRetailDealer[scKey][brand] = invJson.retailDealerMonthly?.[scKey]?.[brand] ?? new Array(12).fill(null);
        }
      }

      // 대리상 ACC 연간: PL(sim) 메인·재고자산(sim)과 동일하게 dealerAccOtbByBrand 사용.
      // (시나리오별 base 대비 OTB 스케일은 제거 — 재고 쪽은 기초·기말·리테일로 Sell-in이 맞춰지는 로직이 기준이며, PL 그리드와 불일치를 유발함)

      // PL 파이프라인 재계산 (순수 함수 - 현재 컴포넌트 state 사용)
      const computeOnePL = (scDirectRetail: Record<SalesBrand, (number | null)[]>, scDealerRetail: Record<SalesBrand, (number | null)[]>): ScenarioResult => {
        const be = () => new Array(12).fill(null) as (number | null)[];
        const latestSupportCutoff = salesSupportActualAvailableMonths.length === 0 ? 0 : Math.max(...salesSupportActualAvailableMonths);
        const latestBrandActual = brandActualAvailableMonths.length === 0 ? 0 : Math.max(...brandActualAvailableMonths);

        // Step 1: salesDerived
        const scSD: Record<string, { monthly: (number | null)[] }> = {};
        for (const row of salesRows) {
          if (!row.isGroup && row.leafKind) {
            let monthly: (number | null)[];
            if (row.leafKind === 'dealerCurrS') {
              monthly = dealerSeasonMonthlyByBrand[row.brand].당년S;
            } else if (row.leafKind === 'dealerCurrF') {
              monthly = dealerSeasonMonthlyByBrand[row.brand].당년F;
            } else if (row.leafKind === 'dealerYear1') {
              monthly = dealerSeasonMonthlyByBrand[row.brand]['1년차'];
            } else if (row.leafKind === 'dealerNext') {
              monthly = dealerSeasonMonthlyByBrand[row.brand].차기시즌;
            } else if (row.leafKind === 'dealerAcc') {
              const brand = row.brand;
              const annualOtb = dealerAccOtbByBrand[brand];
              const actualSeries = salesSupportActualByBrand[brand]?.ACC ?? be();
              let actualSum = 0;
              for (let i = 0; i < latestSupportCutoff; i++) actualSum += actualSeries[i] ?? 0;
              const remaining = annualOtb - actualSum;
              let remainingRatioSum = 0;
              for (let i = latestSupportCutoff; i < 12; i++) remainingRatioSum += accRatioByBrand[brand][i] ?? 0;
              monthly = makeMonthlyArray((idx) => {
                if (idx < latestSupportCutoff) return actualSeries[idx] ?? 0;
                const ratio = accRatioByBrand[brand][idx] ?? 0;
                if (remainingRatioSum === 0) return annualOtb * ratio;
                return remaining * (ratio / remainingRatioSum);
              });
            } else {
              monthly = makeMonthlyArray((idx) => {
                if (idx + 1 <= latestBrandActual) return null;
                return scDirectRetail[row.brand]?.[idx] ?? null;
              });
            }
            scSD[row.id] = { monthly };
          }
        }
        for (const brand of SALES_BRANDS) {
          const dS = scSD[`dealerS:${brand}`]?.monthly ?? be();
          const dF = scSD[`dealerF:${brand}`]?.monthly ?? be();
          const dY1 = scSD[`dealerYear1:${brand}`]?.monthly ?? be();
          const dNext = scSD[`dealerNext:${brand}`]?.monthly ?? be();
          const dCloth = sumSeries(sumSeries(dS, dF), sumSeries(dY1, dNext));
          scSD[`dealerCloth:${brand}`] = { monthly: dCloth };
          const dAcc = scSD[`dealerACC:${brand}`]?.monthly ?? be();
          const dir = scSD[`direct:${brand}`]?.monthly ?? be();
          scSD[`brand:${brand}`] = { monthly: sumSeries(sumSeries(dCloth, dAcc), dir) };
        }

        // Step 2: salesChannelByBrand
        const scSC: Record<SalesBrand, { dealerCloth: (number | null)[]; dealerAcc: (number | null)[]; dealer: (number | null)[]; direct: (number | null)[] }> = {
          MLB: { dealerCloth: be(), dealerAcc: be(), dealer: be(), direct: be() },
          'MLB KIDS': { dealerCloth: be(), dealerAcc: be(), dealer: be(), direct: be() },
          DISCOVERY: { dealerCloth: be(), dealerAcc: be(), dealer: be(), direct: be() },
        };
        for (const brand of SALES_BRANDS) {
          const pDCloth = scSD[`dealerCloth:${brand}`]?.monthly ?? be();
          const pDAcc = scSD[`dealerACC:${brand}`]?.monthly ?? be();
          const pDealer = sumSeries(pDCloth, pDAcc);
          const pDirect = scSD[`direct:${brand}`]?.monthly ?? be();
          const dealerCloth = be(); const dealerAcc = be(); const dealer = be(); const direct = be();
          const sa = salesSupportActualByBrand[brand] ?? { 당년S: be(), 당년F: be(), '1년차': be(), 차기시즌: be(), ACC: be() };
          for (let i = 0; i < 12; i++) {
            const aDealer = brandActualByBrand[brand]?.tag?.dealer?.[i] ?? null;
            const aDirect = brandActualByBrand[brand]?.tag?.direct?.[i] ?? null;
            const sClothRaw = [sa.당년S[i], sa.당년F[i], sa['1년차'][i], sa.차기시즌[i]];
            const sCloth = sClothRaw.some((v) => v !== null) ? sClothRaw.reduce<number>((s, v) => s + (v ?? 0), 0) : null;
            const sAcc = sa.ACC[i] ?? null;
            const aDCloth = i < latestSupportCutoff ? (sCloth ?? (brandActualByBrand[brand]?.tag?.dealerCloth?.[i] ?? null)) : (brandActualByBrand[brand]?.tag?.dealerCloth?.[i] ?? null);
            const aDAcc = i < latestSupportCutoff ? (sAcc ?? (brandActualByBrand[brand]?.tag?.dealerAcc?.[i] ?? null)) : (brandActualByBrand[brand]?.tag?.dealerAcc?.[i] ?? null);
            const dVal = aDealer ?? pDealer[i] ?? null;
            const drVal = aDirect ?? pDirect[i] ?? null;
            dealer[i] = dVal; direct[i] = drVal;
            if (aDCloth !== null || aDAcc !== null) {
              dealerCloth[i] = aDCloth ?? 0; dealerAcc[i] = aDAcc ?? 0;
            } else {
              const sp = splitByPlannedRatio(dVal, pDCloth[i] ?? null, pDAcc[i] ?? null);
              dealerCloth[i] = sp.a; dealerAcc[i] = sp.b;
            }
          }
          scSC[brand] = { dealerCloth, dealerAcc, dealer, direct };
        }

        // Step 3: tagSalesMonthly
        const scTS: Record<SalesBrand, (number | null)[]> = {
          MLB: sumSeries(scSC.MLB.dealer, scSC.MLB.direct),
          'MLB KIDS': sumSeries(scSC['MLB KIDS'].dealer, scSC['MLB KIDS'].direct),
          DISCOVERY: sumSeries(scSC.DISCOVERY.dealer, scSC.DISCOVERY.direct),
        };

        // Step 4: salesActual
        const scSA: Record<SalesBrand, { dealerCloth: (number | null)[]; dealerAcc: (number | null)[]; dealer: (number | null)[]; direct: (number | null)[]; total: (number | null)[] }> = {
          MLB: { dealerCloth: be(), dealerAcc: be(), dealer: be(), direct: be(), total: be() },
          'MLB KIDS': { dealerCloth: be(), dealerAcc: be(), dealer: be(), direct: be(), total: be() },
          DISCOVERY: { dealerCloth: be(), dealerAcc: be(), dealer: be(), direct: be(), total: be() },
        };
        for (const brand of SALES_BRANDS) {
          const pDCloth = applyRate(scSC[brand].dealerCloth, SHIPMENT_RATE_PERCENT_BY_CHANNEL.dealerCloth[brand]);
          const pDAcc = applyRate(scSC[brand].dealerAcc, SHIPMENT_RATE_PERCENT_BY_CHANNEL.dealerAcc[brand]);
          const pDealer = sumSeries(pDCloth, pDAcc);
          const pDirect = applyRate(scSC[brand].direct, SHIPMENT_RATE_PERCENT_BY_CHANNEL.direct[brand]);
          const dealerCloth = be(); const dealerAcc = be(); const dealer = be(); const direct = be();
          for (let i = 0; i < 12; i++) {
            const aDealer = brandActualByBrand[brand]?.sales?.dealer?.[i] ?? null;
            const aDirect = brandActualByBrand[brand]?.sales?.direct?.[i] ?? null;
            const aDCloth = brandActualByBrand[brand]?.sales?.dealerCloth?.[i] ?? null;
            const aDAcc = brandActualByBrand[brand]?.sales?.dealerAcc?.[i] ?? null;
            const dVal = aDealer ?? pDealer[i] ?? null;
            const drVal = aDirect ?? pDirect[i] ?? null;
            dealer[i] = dVal; direct[i] = drVal;
            if (aDCloth !== null || aDAcc !== null) {
              dealerCloth[i] = aDCloth ?? 0; dealerAcc[i] = aDAcc ?? 0;
            } else {
              const sp = splitByPlannedRatio(dVal, pDCloth[i] ?? null, pDAcc[i] ?? null);
              dealerCloth[i] = sp.a; dealerAcc[i] = sp.b;
            }
          }
          scSA[brand] = { dealerCloth, dealerAcc, dealer, direct, total: sumSeries(dealer, direct) };
        }

        // Step 5: monthlyInputs (기존 inputs 복사 후 시나리오 값으로 덮어쓰기)
        const scMI: MonthlyInputs = {
          mlb: { ...monthlyInputs.mlb },
          kids: { ...monthlyInputs.kids },
          discovery: { ...monthlyInputs.discovery },
        };
        (Object.entries(FORECAST_TO_SALES_BRAND) as [ForecastLeafBrand, SalesBrand][]).forEach(([fBrand, sBrand]) => {
          scMI[fBrand] = { ...scMI[fBrand] };
          scMI[fBrand]['Tag매출'] = [...scTS[sBrand]];
          scMI[fBrand]['실판매출'] = [...scSA[sBrand].total];
          const accountOverrides = brandActualByBrand[sBrand]?.accounts ?? {};
          const tagCostRatioSeries = tagCostRatioByBrand[sBrand] ?? be();
          const cogs = [...(scMI[fBrand]['매출원가'] ?? be())];
          for (let i = 0; i < 12; i++) {
            if (i + 1 <= latestActualMonth) continue;
            if (accountOverrides['매출원가']?.[i] !== null && accountOverrides['매출원가']?.[i] !== undefined) continue;
            const tag = scMI[fBrand]['Tag매출']?.[i] ?? null;
            const ratio = tagCostRatioSeries[i] ?? null;
            if (tag === null || ratio === null) continue;
            cogs[i] = (tag / 1.13) * ratio;
          }
          scMI[fBrand]['매출원가'] = cogs;
          const directExpRatio = directExpenseRatioByBrand[sBrand] ?? {};
          const salesSeries = scMI[fBrand]['실판매출'] ?? be();
          for (const account of DIRECT_EXPENSE_ACCOUNTS) {
            const ratioSeries = directExpRatio[account];
            if (!ratioSeries) continue;
            const cur = [...(scMI[fBrand][account] ?? be())];
            for (let i = 0; i < 12; i++) {
              if (i + 1 <= latestActualMonth) continue;
              if (accountOverrides[account]?.[i] !== null && accountOverrides[account]?.[i] !== undefined) continue;
              const sales = salesSeries[i] ?? null;
              const ratio = ratioSeries[i] ?? null;
              if (ratio === null) continue;
              if (!FIXED_COST_ACCOUNTS.has(account) && sales === null) continue;
              cur[i] = FIXED_COST_ACCOUNTS.has(account) ? ratio : sales! * ratio;
            }
            scMI[fBrand][account] = cur;
          }
        });

        // Step 6: calculatedByBrand
        const scCB: Record<ForecastLeafBrand, CalculatedSeries> = {
          mlb: deriveCalculated(scMI.mlb, ANNUAL_2025_RAW_BY_BRAND.mlb, financialAdjust26, financialAdjust25),
          kids: deriveCalculated(scMI.kids, ANNUAL_2025_RAW_BY_BRAND.kids),
          discovery: deriveCalculated(scMI.discovery, ANNUAL_2025_RAW_BY_BRAND.discovery),
        };

        // Step 7: corporateCalculated
        const corpRaw: Record<string, (number | null)[]> = {};
        for (const account of RAW_ACCOUNTS) {
          corpRaw[account] = makeMonthlyArray((idx) => {
            const v1 = scMI.mlb[account]?.[idx] ?? null;
            const v2 = scMI.kids[account]?.[idx] ?? null;
            const v3 = scMI.discovery[account]?.[idx] ?? null;
            if (v1 === null && v2 === null && v3 === null) return null;
            return (v1 ?? 0) + (v2 ?? 0) + (v3 ?? 0);
          });
        }
        const corpAnnual: Record<string, number> = {};
        for (const account of RAW_ACCOUNTS) {
          corpAnnual[account] = (ANNUAL_2025_RAW_BY_BRAND.mlb[account] ?? 0) + (ANNUAL_2025_RAW_BY_BRAND.kids[account] ?? 0) + (ANNUAL_2025_RAW_BY_BRAND.discovery[account] ?? 0);
        }
        const scCorpCalc = deriveCalculated(corpRaw, corpAnnual, financialAdjust26, financialAdjust25);

        const sb = (get: (b: SalesBrand) => (number | null)[]) => sumSeries(sumSeries(get('MLB'), get('MLB KIDS')), get('DISCOVERY'));

        // 시나리오 리테일매출 계산: 실적월은 CSV, 계획월은 Tag리테일 × (1 - 전년할인율)
        const scRetail: Record<SalesBrand, { dealer: (number | null)[]; direct: (number | null)[]; total: (number | null)[] }> = {
          MLB: { dealer: be(), direct: be(), total: be() },
          'MLB KIDS': { dealer: be(), direct: be(), total: be() },
          DISCOVERY: { dealer: be(), direct: be(), total: be() },
        };
        for (const brand of SALES_BRANDS) {
          const actualDealer = brandActualByBrand[brand]?.retail?.dealer ?? be();
          const actualDirect = brandActualByBrand[brand]?.retail?.direct ?? be();
          const tagDealer = scDealerRetail[brand] ?? be();
          const tagDirect = scDirectRetail[brand] ?? be();
          const discDealer = prevYearDiscountByBrand[brand]?.dealer ?? be();
          const discDirect = prevYearDiscountByBrand[brand]?.direct ?? be();
          for (let i = 0; i < 12; i++) {
            const aD = actualDealer[i];
            const aH = actualDirect[i];
            scRetail[brand].dealer[i] = aD !== null ? aD : (tagDealer[i] !== null ? tagDealer[i]! * (1 - (discDealer[i] ?? 0)) : null);
            scRetail[brand].direct[i] = aH !== null ? aH : (tagDirect[i] !== null ? tagDirect[i]! * (1 - (discDirect[i] ?? 0)) : null);
          }
          scRetail[brand].total = sumSeries(scRetail[brand].dealer, scRetail[brand].direct);
        }

        const fBrandRetail = (fBrand: ForecastLeafBrand) => {
          const sBrand = FORECAST_TO_SALES_BRAND[fBrand];
          return scRetail[sBrand];
        };

        return {
          byBrand: {
            mlb: { tagSalesMonthly: scTS.MLB, salesChannel: scSC.MLB, salesActual: scSA.MLB, retail: fBrandRetail('mlb'), calculated: scCB.mlb },
            kids: { tagSalesMonthly: scTS['MLB KIDS'], salesChannel: scSC['MLB KIDS'], salesActual: scSA['MLB KIDS'], retail: fBrandRetail('kids'), calculated: scCB.kids },
            discovery: { tagSalesMonthly: scTS.DISCOVERY, salesChannel: scSC.DISCOVERY, salesActual: scSA.DISCOVERY, retail: fBrandRetail('discovery'), calculated: scCB.discovery },
          },
          corporate: {
            tagSalesMonthly: sb((b) => scTS[b]),
            salesChannel: {
              dealerCloth: sb((b) => scSC[b].dealerCloth),
              dealerAcc: sb((b) => scSC[b].dealerAcc),
              dealer: sb((b) => scSC[b].dealer),
              direct: sb((b) => scSC[b].direct),
            },
            salesActual: {
              dealerCloth: sb((b) => scSA[b].dealerCloth),
              dealerAcc: sb((b) => scSA[b].dealerAcc),
              dealer: sb((b) => scSA[b].dealer),
              direct: sb((b) => scSA[b].direct),
              total: sb((b) => scSA[b].total),
            },
            retail: {
              dealer: sb((b) => scRetail[b].dealer),
              direct: sb((b) => scRetail[b].direct),
              total: sb((b) => scRetail[b].total),
            },
            calculated: scCorpCalc,
          },
        };
      };

      const allData: AllScenarioData = {
        base: computeOnePL(scenarioRetailHq.base, scenarioRetailDealer.base),
        positive: computeOnePL(scenarioRetailHq.positive, scenarioRetailDealer.positive),
        negative: computeOnePL(scenarioRetailHq.negative, scenarioRetailDealer.negative),
      };

      setScenarioData(allData);

      // ─── 운전자본표 데이터 계산 ─────────────────────────────────────────────
      try {
        // 재고 closing도 override 우선. override가 없을 때만 API GET으로 기본값 읽음.
        const wcRes = await fetch('/api/pl-forecast/wc-forecast');
        let invClosingRaw: Partial<Record<ScenarioKey, Partial<Record<SalesBrand, number>>>> = {};
        if (scenarioOverride) {
          invClosingRaw = scenarioOverride.closing;
        } else {
          const invRes = await fetch('/api/inventory/scenario-inventory');
          const invJsonWc = invRes.ok ? await invRes.json() : null;
          invClosingRaw = invJsonWc?.closing ?? {};
        }
        const wcJson = wcRes.ok ? await wcRes.json() : null;

        const invClosing: Partial<Record<ScenarioKey, Partial<Record<SalesBrand, number>>>> = invClosingRaw;
        const arBaseK = wcJson?.wc_ar != null ? wcJson.wc_ar / 1000 : null;
        const apBaseK = wcJson?.wc_ap != null ? wcJson.wc_ap / 1000 : null;

        // tagCostRatio (localStorage: pl_tag_cost_ratio_annual → { values: { MLB, 'MLB KIDS', DISCOVERY } })
        let tagCostRatioWc: Record<SalesBrand, number> | null = null;
        try {
          const raw = window.localStorage.getItem('pl_tag_cost_ratio_annual');
          if (raw) tagCostRatioWc = JSON.parse(raw)?.values ?? null;
        } catch (_e) { /* ignore */ }

        // CF(sim)과 동일한 평가감율
        const WC_VAL_RATE: Record<SalesBrand, number> = {
          MLB: 0.133924, 'MLB KIDS': 0.276843, DISCOVERY: 0.02253,
        };
        const WC_BRANDS: SalesBrand[] = ['MLB', 'MLB KIDS', 'DISCOVERY'];

        const computeInvDetail = (tagByBrand: Partial<Record<SalesBrand, number>>): { total: number; byBrand: Record<SalesBrand, ScenarioWcInvBrand> } | null => {
          if (!tagCostRatioWc) return null;
          let total = 0;
          const byBrand = {} as Record<SalesBrand, ScenarioWcInvBrand>;
          for (const b of WC_BRANDS) {
            const tagK = tagByBrand[b] ?? 0;
            const costRatio = tagCostRatioWc![b] ?? 0;
            const valRate = WC_VAL_RATE[b];
            const costK = (tagK / 1.13) * costRatio * (1 - valRate);
            byBrand[b] = { tagK, costRatio, valRate, costK };
            total += costK;
          }
          return { total, byBrand };
        };

        // V+ 연간합계 (AR/AP 스케일링 기준)
        const getVPlusAnnual = (scData: ScenarioResult) => {
          const total = scData.corporate.salesActual.total;
          return total.reduce((sum: number, v) => sum + (v ?? 0), 0) * 1.13;
        };
        const vPlusBase = getVPlusAnnual(allData.base);
        const vPlusNeg = getVPlusAnnual(allData.negative);
        const vPlusPos = getVPlusAnnual(allData.positive);

        const scaleFromBase = (baseK: number | null, vPlusSc: number) => {
          if (baseK === null || vPlusBase === 0) return baseK;
          return baseK * (vPlusSc / vPlusBase);
        };

        // 2025 실적 (CF(sim) STATIC_WORKING_CAPITAL_ROWS 기준, K CNY)
        const actual2025: ScenarioWcRow = {
          ar: 725184,
          inventory: 1497796,
          ap: -753922,
          total: 725184 + 1497796 + (-753922),
        };

        const computeScRow = (scKey: ScenarioKey, vPlus: number): ScenarioWcRow => {
          const ar = scaleFromBase(arBaseK, vPlus);
          const ap = scaleFromBase(apBaseK, vPlus);
          const invTag = invClosing[scKey];
          const invDetail = invTag ? computeInvDetail(invTag) : null;
          const inventory = invDetail?.total ?? null;
          const total = ar !== null && inventory !== null && ap !== null ? ar + inventory + ap : null;
          return { ar, inventory, inventoryByBrand: invDetail?.byBrand, ap, total };
        };

        setScenarioWcData({
          actual2025,
          scenarios: {
            base: computeScRow('base', vPlusBase),
            negative: computeScRow('negative', vPlusNeg),
            positive: computeScRow('positive', vPlusPos),
          },
          invDataMissing: !invJson?.closing,
        });
      } catch (_wcErr) { /* WC 계산 실패 무시 */ }
      // ────────────────────────────────────────────────────────────────────────

      setScenarioLoading(false);
    } catch (err) {
      setScenarioError(err instanceof Error ? err.message : '시나리오 계산 오류가 발생했습니다.');
      setScenarioLoading(false);
    }
  };
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="h-[calc(100vh-64px)] overflow-auto bg-[radial-gradient(1200px_500px_at_10%_-20%,#e0e7ff_0%,transparent_55%),radial-gradient(900px_420px_at_100%_0%,#dbeafe_0%,transparent_45%),linear-gradient(180deg,#f8fafc_0%,#f1f5f9_100%)]">
      <div className="sticky top-0 z-[60] border-b border-slate-200/80 bg-white/95 shadow-sm backdrop-blur-md">
        <div className="px-6 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="mr-2 whitespace-nowrap text-sm font-semibold tracking-tight text-slate-800">
              PL Forecast (FY26)
            </div>
            <div className="inline-flex rounded-xl border border-slate-300/80 bg-slate-200/70 p-1 shadow-inner">
              {FORECAST_BRANDS.map((brand) => {
                const selected = activeBrand === brand.id;
                return (
                  <button
                    key={brand.id ?? 'corp'}
                    type="button"
                    onClick={() => setActiveBrand(brand.id)}
                    className={`rounded-lg px-4 py-2 text-sm font-semibold transition-all ${
                      selected
                        ? 'bg-gradient-to-b from-[#4a6694] to-[#3a5583] text-white shadow-[0_2px_8px_rgba(58,85,131,0.35)]'
                        : 'text-slate-600 hover:bg-white/90 hover:text-slate-800'
                    }`}
                  >
                    {brand.label}
                  </button>
                );
              })}
            </div>

            <div className="h-6 w-px bg-slate-300" />

            <button
              type="button"
              onClick={() => {
                const groups = rowDefs.filter((r) => r.isGroup).map((r) => r.account);
                if (hasAnyExpanded) {
                  setCollapsed(new Set(groups));
                } else {
                  setCollapsed(new Set());
                }
              }}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
            >
              {hasAnyExpanded ? '전체 접기' : '전체 펼치기'}
            </button>

            {latestActualMonth > 0 && (
              <div className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs text-blue-700 shadow-sm">
                실적 1~{latestActualMonth}월 반영
              </div>
            )}

            <div
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs shadow-sm ${
                isLoadingAny
                  ? 'border-amber-300 bg-amber-50 text-amber-700'
                  : hasAnyLoadError
                    ? 'border-red-200 bg-red-50 text-red-600'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-700'
              }`}
            >
              {isLoadingAny ? (
                <>
                  <span className="font-mono tracking-tight">
                    {'█'.repeat(doneLoadCount)}{'░'.repeat(totalLoadCount - doneLoadCount)}
                  </span>
                  <span>{doneLoadCount}/{totalLoadCount}</span>
                </>
              ) : hasAnyLoadError ? '오류' : 'PL 계산완료'}
            </div>

            <span className="font-bold text-red-600" style={{ fontSize: '20px' }}>
              ※ 필수 방문순서: 재고자산(sim) 방문후 PL 참고해주세요
            </span>

            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => void openScenarioModal()}
                className="flex items-center gap-1.5 rounded-full border border-violet-300 bg-violet-50 px-4 py-1.5 text-xs font-semibold text-violet-700 shadow-sm transition-colors hover:bg-violet-100"
              >
                ⚖ 시나리오 비교
              </button>
            </div>
            <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-500 shadow-sm">
              단위: CNY K
            </div>
          </div>
        </div>
      </div>

      <div className="p-6">
        <div
          className="overflow-auto rounded-2xl border border-slate-200 bg-white/95 shadow-[0_10px_30px_rgba(15,23,42,0.08)]"
          style={{ maxHeight: 'calc(100vh - 220px)' }}
        >
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead className="sticky top-0 z-20">
              <tr>
                <th className="sticky left-0 z-30 min-w-[260px] border-b border-r border-slate-300 bg-gradient-to-r from-[#2f4f7f] to-[#3b5f93] px-4 py-3 text-center font-semibold text-white">
                  계정과목
                </th>
                <th className="min-w-[130px] border-b border-r border-slate-300 bg-gradient-to-r from-[#3b5f93] to-[#4b6fa3] px-3 py-3 text-center font-semibold text-slate-50">
                  25년(연간)
                </th>
                {MONTH_HEADERS.map((month) => (
                  <th
                    key={month}
                    className="min-w-[105px] border-b border-r border-slate-300 bg-gradient-to-r from-[#2f4f7f] to-[#3b5f93] px-3 py-3 text-center font-semibold text-slate-50"
                  >
                    {month}
                  </th>
                ))}
                <th className="min-w-[130px] border-b border-r border-slate-300 bg-gradient-to-r from-[#3b5f93] to-[#4b6fa3] px-3 py-3 text-center font-semibold text-slate-50">
                  26년(연간)
                </th>
                <th className="min-w-[100px] border-b border-r border-slate-300 bg-gradient-to-r from-[#4b6fa3] to-[#5c80b1] px-3 py-3 text-center font-semibold text-slate-50">
                  YoY
                </th>
                <th className="min-w-[120px] border-b border-slate-300 bg-slate-700 px-3 py-3 text-center font-semibold text-slate-50">
                  {latestActualMonth > 0 ? `YTD(1~${latestActualMonth}월)` : 'YTD'}
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => {
                const series = getRowSeries(row.account);
                const annual26 = getAnnual26Value(row.account);
                const isRateYoY = row.account === '영업이익률(관리식)' || row.account === '영업이익률(재무식)' || row.account === '(Tag 대비 원가율)';
                const yoyText = isRateYoY
                  ? (annual26 !== null && series.annual2025 !== null ? `${(annual26 - series.annual2025) * 100 >= 0 ? '+' : ''}${((annual26 - series.annual2025) * 100).toFixed(1)}%p` : '-')
                  : formatYoYByAnnual(annual26, series.annual2025);
                const isGroupCollapsed = row.isGroup && collapsed.has(row.account);
                const accountLabel = ACCOUNT_LABEL_OVERRIDES[row.account] ?? row.account;
                const isProfitFocusRow = ['매출총이익', '영업이익(관리식)', '영업이익률(관리식)'].includes(row.account);
                const isMintRow = ['영업이익(재무식)', '영업이익률(재무식)'].includes(row.account);
                const isAdjustGroupRow = row.account === '재무&관리차이(-)';
                const rowTone =
                  isMintRow
                    ? 'bg-emerald-100'
                    : isAdjustGroupRow
                      ? 'bg-highlight-gray'
                      : isProfitFocusRow
                        ? 'bg-sky-100'
                        : row.level === 0
                          ? (row.isBold ? 'bg-slate-50' : 'bg-white')
                          : row.level === 1
                            ? 'bg-white'
                            : 'bg-slate-50/40';

                return (
                  <tr key={row.account} className={`${rowTone} transition-colors hover:bg-sky-50/50`}>
                    <td className="sticky left-0 z-10 border-b border-r border-slate-200 px-4 py-2.5" style={{ paddingLeft: `${16 + row.level * 18}px` }}>
                      <div className="flex items-center gap-2">
                        <span className={row.isBold ? 'font-semibold text-slate-800' : 'text-slate-700'}>{accountLabel}</span>
                        {row.isGroup ? (
                          <button
                            type="button"
                            onClick={() => {
                              setCollapsed((prev) => {
                                const next = new Set(prev);
                                if (next.has(row.account)) next.delete(row.account);
                                else next.add(row.account);
                                return next;
                              });
                            }}
                            className="inline-flex h-5 w-5 items-center justify-center rounded border border-slate-300 bg-white text-[11px] text-slate-500"
                          >
                            {isGroupCollapsed ? '+' : '-'}
                          </button>
                        ) : (
                          <span className="inline-flex h-5 w-5" />
                        )}
                      </div>
                    </td>
                    <td className="border-b border-r border-slate-200 px-3 py-2.5 text-right text-slate-700">{formatValue(series.annual2025, row.format)}</td>
                    {MONTH_HEADERS.map((_, monthIndex) => (
                      <td key={`${row.account}-${monthIndex}`} className="border-b border-r border-slate-200 px-2.5 py-1.5 text-right text-slate-700">
                        {renderMonthInput(row, monthIndex)}
                      </td>
                    ))}
                    <td className={`border-b border-r border-slate-200 px-3 py-2.5 text-right font-medium text-slate-800 ${isMintRow ? 'bg-emerald-100' : isAdjustGroupRow ? 'bg-highlight-gray' : isProfitFocusRow ? 'bg-sky-100' : 'bg-slate-50'}`}>
                      {formatValue(annual26, row.format)}
                    </td>
                    <td className={`border-b border-r border-slate-200 px-3 py-2.5 text-right text-slate-500 ${isMintRow ? 'bg-emerald-100' : isAdjustGroupRow ? 'bg-highlight-gray' : isProfitFocusRow ? 'bg-sky-100' : 'bg-slate-50'}`}>{yoyText}</td>
                    <td className={`border-b border-slate-200 px-3 py-2.5 text-right font-medium text-slate-800 ${isMintRow ? 'bg-emerald-100' : isAdjustGroupRow ? 'bg-highlight-gray' : isProfitFocusRow ? 'bg-sky-100' : 'bg-slate-50'}`}>
                      {(() => {
                        if (latestActualMonth <= 0) return '';
                        if (isRateYoY) {
                          // 비율 계정: YTD 재계산
                          if (row.account === '영업이익률(관리식)') {
                            const oiYtd = sumOrNull(getRowSeries('영업이익(관리식)').monthly.slice(0, latestActualMonth));
                            const salesYtd = sumOrNull(getRowSeries('실판매출').monthly.slice(0, latestActualMonth));
                            return oiYtd !== null && salesYtd !== null && salesYtd !== 0 ? formatValue(oiYtd / salesYtd, 'percent') : '';
                          }
                          if (row.account === '영업이익률(재무식)') {
                            const oiYtd = sumOrNull(getRowSeries('영업이익(재무식)').monthly.slice(0, latestActualMonth));
                            const salesYtd = sumOrNull(getRowSeries('실판매출').monthly.slice(0, latestActualMonth));
                            return oiYtd !== null && salesYtd !== null && salesYtd !== 0 ? formatValue(oiYtd / salesYtd, 'percent') : '';
                          }
                          if (row.account === '(Tag 대비 원가율)') {
                            const cogsYtd = sumOrNull(getRowSeries('매출원가').monthly.slice(0, latestActualMonth));
                            const tagYtd = sumOrNull(getRowSeries('Tag매출').monthly.slice(0, latestActualMonth));
                            return cogsYtd !== null && tagYtd !== null && tagYtd !== 0 ? formatValue((cogsYtd * 1.13) / tagYtd, 'percent') : '';
                          }
                          return '';
                        }
                        const ytdValue = sumOrNull(series.monthly.slice(0, latestActualMonth));
                        return formatValue(ytdValue, row.format);
                      })()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-3 rounded-xl border border-slate-200 bg-white/85 px-4 py-3 text-xs text-slate-600 shadow-sm">
          <button
            type="button"
            onClick={() => setLogicGuideCollapsed((prev) => !prev)}
            className="flex w-full items-center gap-3 text-left"
          >
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-[#3b5f93] text-white text-xs font-semibold">
              PL
            </span>
            <span className="flex-1 font-semibold text-slate-700">PL 계산 로직</span>
            <span className="text-slate-500">{logicGuideCollapsed ? '펼치기' : '접기'}</span>
          </button>
          {!logicGuideCollapsed && (
            <div className="mt-3 grid grid-cols-3 gap-3" style={{ gridTemplateRows: 'auto auto' }}>

              {/* ①② — col 1, row 1~2 */}
              <div className="col-start-1 row-start-1 row-span-2 rounded-lg border border-slate-200 bg-slate-50/70 px-4 py-3 space-y-2">
                <div className="font-semibold text-slate-700 border-b border-slate-200 pb-1">① 실적월 반영 원칙</div>
                <div className="text-slate-500">실적월(해당 월 CSV 존재 시) — 매출·원가·비용 전부 CSV 값 우선 적용</div>
                <div className="text-slate-500">경로: <span className="font-mono text-blue-600 font-semibold">보조파일(simu)/pl_brand_actual_K/2026-mm.csv</span></div>

                <div className="font-semibold text-slate-700 border-b border-slate-200 pb-1 pt-2">② Tag매출 계산 (계획월)</div>
                <div className="pl-2 space-y-0.5 text-slate-600">
                  <div>· 대리상의 의류, ACC, 직영 → <span className="font-mono">매출보조지표</span></div>
                  <div>· 대리상 합계 = <span className="font-mono">의류 + ACC</span></div>
                  <div>· 총합 = <span className="font-mono">대리상 + 직영</span></div>
                </div>
              </div>

              {/* ③ 실판매출 — col 2, row 1~2 */}
              <div className="col-start-2 row-start-1 row-span-2 rounded-lg border border-slate-200 bg-slate-50/70 px-4 py-3 space-y-2">
                <div className="font-semibold text-slate-700 border-b border-slate-200 pb-1">③ 실판매출 계산 (계획월)</div>
                <div className="pl-2 space-y-1 text-slate-600">
                  <div>· 대리상 = <span className="font-mono">(Tag의류 × 의류출고율 + Tag ACC × ACC출고율) ÷ 1.13</span></div>
                  <div>· 직영 = <span className="font-mono">(Tag직영 × 직영출고율) ÷ 1.13</span> <span className="text-slate-400">※ 출고율 90% = Tag의 10% 할인 예상</span></div>
                  <div className="mt-1">
                    <table className="text-xs border border-slate-200 rounded w-auto text-center">
                      <colgroup>
                        <col className="w-16" />
                        <col className="w-20" />
                        <col className="w-20" />
                        <col className="w-20" />
                      </colgroup>
                      <thead className="bg-slate-100 text-slate-600">
                        <tr>
                          <th className="border border-slate-200 px-2 py-1">채널</th>
                          <th className="border border-slate-200 px-2 py-1">MLB</th>
                          <th className="border border-slate-200 px-2 py-1">MLB KIDS</th>
                          <th className="border border-slate-200 px-2 py-1">DISCOVERY</th>
                        </tr>
                      </thead>
                      <tbody className="text-slate-700">
                        <tr>
                          <td className="border border-slate-200 px-2 py-1">의류</td>
                          <td className="border border-slate-200 px-2 py-1">42%</td>
                          <td className="border border-slate-200 px-2 py-1">42%</td>
                          <td className="border border-slate-200 px-2 py-1">45%</td>
                        </tr>
                        <tr>
                          <td className="border border-slate-200 px-2 py-1">ACC</td>
                          <td className="border border-slate-200 px-2 py-1">47%</td>
                          <td className="border border-slate-200 px-2 py-1">42%</td>
                          <td className="border border-slate-200 px-2 py-1">45%</td>
                        </tr>
                        <tr>
                          <td className="border border-slate-200 px-2 py-1">직영</td>
                          <td className="border border-slate-200 px-2 py-1">90%</td>
                          <td className="border border-slate-200 px-2 py-1">90%</td>
                          <td className="border border-slate-200 px-2 py-1">90%</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div>· 총합 = <span className="font-mono">대리상 + 직영</span></div>
                </div>
              </div>

              {/* ④ 비용계정 — col 3, row 1 */}
              <div className="col-start-3 row-start-1 rounded-lg border border-slate-200 bg-slate-50/70 px-4 py-3 space-y-2">
                <div className="font-semibold text-slate-700 border-b border-slate-200 pb-1">④ 비용계정 (계획월)</div>
                <div className="pl-2 space-y-2 text-slate-600">
                  <div>
                    <div className="font-medium text-slate-700">· 매출원가</div>
                    <div className="pl-3">= <span className="font-mono">(Tag매출 ÷ 1.13) × Tag대비원가율</span></div>
                    <div className="pl-3 font-mono text-blue-600 font-semibold text-xs mt-0.5">보조파일(simu)/Tag대비원가율.csv</div>
                  </div>
                  <div>
                    <div className="font-medium text-slate-700">· 직접비</div>
                    <div className="pl-3">변동비: <span className="font-mono">실판매출 × CSV비율</span></div>
                    <div className="pl-3">고정비: <span className="font-mono">CSV 금액 그대로</span></div>
                    <div className="pl-3 font-mono text-blue-600 font-semibold text-xs mt-0.5">보조파일(simu)/pl_brand_forecast_직접비율/&#123;브랜드&#125;.csv</div>
                  </div>
                  <div>
                    <div className="font-medium text-slate-700">· 영업비</div>
                    <div className="pl-3">전 항목 고정비 취급, CSV 계획값 그대로 반영</div>
                    <div className="pl-3 font-mono text-blue-600 font-semibold text-xs mt-0.5">보조파일(simu)/pl_brand_forecast_영업비/&#123;브랜드&#125;.csv</div>
                  </div>
                </div>
              </div>

            </div>
          )}
        </div>

        <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50/85 shadow-sm">
          <button
            type="button"
            onClick={() => setSalesSectionOpen((prev) => !prev)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left"
          >
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-[#3b5f93] text-white text-xs">
              매
            </span>
            <div className="flex-1 flex items-center gap-6">
              <div className="shrink-0">
                <div className="text-sm font-semibold text-slate-800">매출 보조지표 🟢Live</div>
                <div className="text-xs text-slate-500">브랜드/채널/시즌별 월 매출 계획 (OTB 연동)</div>
              </div>
              <div className="text-left text-xs text-slate-800 leading-relaxed">
                <div className="font-mono font-semibold text-blue-600 mb-0.5">보조파일(simu)/매출보조지표_actual/2026-MM.csv</div>
                <div>당년S/F: 실적월 CSV → 잔여(OTB-실적합) × 전년진척률 배분</div>
                <div>1년차: 잔여 × 당년F 진척률 배분&nbsp;|&nbsp;차기시즌: 잔여 ÷ 2 → 11·12월 균등</div>
                <div>ACC: 실적월 CSV → 잔여 × ACC출고비율 배분</div>
              </div>
            </div>
            <span className="text-xs text-slate-500">{salesSectionOpen ? '접기' : '펼치기'}</span>
          </button>

          {salesSectionOpen && (
            <div className="border-t border-slate-200 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-xs text-slate-500">OTB 매핑: 당년F=26F, 당년S=26S, 1년차=25F, 차기시즌=27F+27S, 대리상(의류)=시즌합</div>
                <div className="flex items-center gap-3">
                  <div className="text-xs text-slate-500">
                    성장률 반영: 대리상 {growthParams.growthRate}% / 직영 {growthParams.growthRateHq}%
                  </div>
                  {otbLoading && <div className="text-xs text-slate-500">OTB 불러오는 중...</div>}
                  {retailLoading && <div className="text-xs text-slate-500">직영 매출 불러오는 중...</div>}
                  {brandActualLoading && <div className="text-xs text-slate-500">실적 CSV 불러오는 중...</div>}
                  {salesSupportActualLoading && <div className="text-xs text-slate-500">매출보조 실적 CSV 불러오는 중...</div>}
                  {opexForecastLoading && <div className="text-xs text-slate-500">영업비 계획 CSV 불러오는 중...</div>}
                  {(otbError || retailError || brandActualError || salesSupportActualError || opexForecastError) && (
                    <div className="text-xs text-red-500">{otbError || retailError || brandActualError || salesSupportActualError || opexForecastError}</div>
                  )}
                </div>
              </div>

              <div className="overflow-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-full border-separate border-spacing-0 text-sm">
                  <thead className="sticky top-0 z-10">
                    <tr>
                      <th className="min-w-[130px] border-b border-r border-slate-300 bg-slate-800 px-3 py-2 text-center font-semibold text-slate-100">브랜드</th>
                      <th className="min-w-[220px] border-b border-r border-slate-300 bg-slate-800 px-3 py-2 text-center font-semibold text-slate-100">채널</th>
                      <th className="min-w-[120px] border-b border-r border-slate-300 bg-slate-700 px-3 py-2 text-center font-semibold text-slate-100">OTB</th>
                      {MONTH_HEADERS.map((month) => (
                        <th key={`sales-${month}`} className="min-w-[95px] border-b border-r border-slate-300 bg-slate-800 px-3 py-2 text-center font-semibold text-slate-100">
                          {month}
                        </th>
                      ))}
                      <th className="min-w-[120px] border-b border-slate-300 bg-slate-700 px-3 py-2 text-center font-semibold text-slate-100">FY26</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleSalesRows.map((row) => {
                      const series = salesDerived[row.id] ?? { monthly: new Array(12).fill(null), fy26: null, otb: null };
                      const isCollapsed = row.isGroup && salesCollapsed.has(row.id);
                      const rowBg = row.level === 1 ? 'bg-slate-100' : row.level === 2 ? 'bg-white' : 'bg-slate-50/70';

                      return (
                        <tr key={row.id} className={`${rowBg} hover:bg-sky-50/50`}>
                          <td className="border-b border-r border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800">
                            {row.level === 1 ? row.brand : ''}
                          </td>
                          <td className="border-b border-r border-slate-200 px-3 py-2" style={{ paddingLeft: `${10 + row.level * 16}px` }}>
                            <div className="flex items-center gap-2">
                              <span className={row.level <= 2 ? 'text-slate-700' : 'text-slate-600'}>{row.accountLabel}</span>
                              {row.isGroup ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSalesCollapsed((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(row.id)) next.delete(row.id);
                                      else next.add(row.id);
                                      return next;
                                    });
                                  }}
                                  className="inline-flex h-5 w-5 items-center justify-center rounded border border-slate-300 bg-white text-[11px] text-slate-500"
                                >
                                  {isCollapsed ? '+' : '-'}
                                </button>
                              ) : (
                                <span className="inline-flex h-5 w-5" />
                              )}
                            </div>
                          </td>
                          <td className="border-b border-r border-slate-200 px-3 py-2 text-right text-slate-700">
                            {row.id.startsWith('dealerCloth:') ||
                            row.id.startsWith('dealerS:') ||
                            row.id.startsWith('dealerF:') ||
                            row.id.startsWith('dealerYear1:') ||
                            row.id.startsWith('dealerNext:') ||
                            row.id.startsWith('dealerACC:')
                              ? formatValue(series.otb, 'number')
                              : ''}
                          </td>
                          {MONTH_HEADERS.map((_, monthIndex) => (
                            <td key={`${row.id}-m${monthIndex}`} className="border-b border-r border-slate-200 px-2 py-1 text-right text-slate-700">
                              <span>{formatValue(series.monthly[monthIndex], 'number')}</span>
                            </td>
                          ))}
                          <td className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-right font-medium text-slate-800">
                            {formatValue(series.fy26, 'number')}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-5 rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-800">대리상 출고 진척률</div>
                    <div className="text-xs text-slate-500">CSV 원천값 반영 (파일 수정 시 재조회 반영)</div>
                  </div>
                  <div className="text-xs text-slate-500">
                    {shipmentProgressLoading ? '불러오는 중...' : shipmentProgressError ? '오류' : '최신값 반영'}
                  </div>
                </div>

                {shipmentProgressError ? (
                  <div className="px-4 py-4 text-sm text-red-500">{shipmentProgressError}</div>
                ) : (
                  <div className="overflow-auto">
                    <table className="w-full border-separate border-spacing-0 text-sm">
                      <thead className="sticky top-0 z-10">
                        <tr>
                          <th className="min-w-[140px] border-b border-r border-slate-300 bg-slate-800 px-3 py-2 text-center font-semibold text-slate-100">브랜드</th>
                          <th className="min-w-[110px] border-b border-r border-slate-300 bg-slate-800 px-3 py-2 text-center font-semibold text-slate-100">시즌</th>
                          <th className="min-w-[140px] border-b border-r border-slate-300 bg-slate-700 px-3 py-2 text-center font-semibold text-slate-100">전년까지진척률</th>
                          {MONTH_HEADERS.map((month) => (
                            <th key={`progress-${month}`} className="min-w-[92px] border-b border-r border-slate-300 bg-slate-800 px-3 py-2 text-center font-semibold text-slate-100">
                              {month}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {shipmentProgressOrderedRows.map((row, idx) => (
                          <tr key={`${row.brand}-${row.season}`} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                            <td className="border-b border-r border-slate-200 px-3 py-2 text-center font-medium text-slate-800">
                              {row.season === DEALER_CLOTH_SEASONS[0] ? row.brand : ''}
                            </td>
                            <td className="border-b border-r border-slate-200 px-3 py-2 text-center text-slate-700">{row.season}</td>
                            <td className="border-b border-r border-slate-200 px-3 py-2 text-right text-slate-700">
                              {formatProgress(row.prevYearProgress)}
                            </td>
                            {MONTH_HEADERS.map((_, monthIndex) => (
                              <td key={`${row.brand}-${row.season}-${monthIndex}`} className="border-b border-r border-slate-200 px-3 py-2 text-right text-slate-700">
                                {formatProgress(row.monthly[monthIndex] ?? null)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="mt-5 rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-800">ACC 출고비율</div>
                    <div className="text-xs text-slate-500">CSV 원천값 반영 (파일 수정 시 재조회 반영)</div>
                  </div>
                  <div className="text-xs text-slate-500">
                    {accRatioLoading ? '불러오는 중...' : accRatioError ? '오류' : '최신값 반영'}
                  </div>
                </div>

                {accRatioError ? (
                  <div className="px-4 py-4 text-sm text-red-500">{accRatioError}</div>
                ) : (
                  <div className="overflow-auto">
                    <table className="w-full border-separate border-spacing-0 text-sm">
                      <thead className="sticky top-0 z-10">
                        <tr>
                          <th className="min-w-[160px] border-b border-r border-slate-300 bg-slate-800 px-3 py-2 text-center font-semibold text-slate-100">브랜드</th>
                          {MONTH_HEADERS.map((month) => (
                            <th key={`acc-ratio-${month}`} className="min-w-[92px] border-b border-r border-slate-300 bg-slate-800 px-3 py-2 text-center font-semibold text-slate-100">
                              {month}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {accRatioOrderedRows.map((row, idx) => (
                          <tr key={`acc-ratio-${row.brand}`} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                            <td className="border-b border-r border-slate-200 px-3 py-2 text-center font-medium text-slate-800">{row.brand}</td>
                            {MONTH_HEADERS.map((_, monthIndex) => (
                              <td key={`acc-ratio-${row.brand}-${monthIndex}`} className="border-b border-r border-slate-200 px-3 py-2 text-right text-slate-700">
                                {formatProgress(row.monthly[monthIndex] ?? null)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="mt-5 rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-800">브랜드별 출고율</div>
                  </div>
                </div>
                <div className="overflow-auto">
                  <table className="w-full border-separate border-spacing-0 text-sm">
                    <thead>
                      <tr>
                        <th className="min-w-[160px] border-b border-r border-slate-300 bg-slate-800 px-3 py-2 text-center font-semibold text-slate-100">
                          대리상 출고율
                        </th>
                        {SALES_BRANDS.map((brand) => (
                          <th
                            key={`brand-rate-head-${brand}`}
                            className="min-w-[120px] border-b border-r border-slate-300 bg-slate-800 px-3 py-2 text-center font-semibold text-slate-100 last:border-r-0"
                          >
                            {brand}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {BRAND_SHIPMENT_RATE_ROWS.map((row, idx) => (
                        <tr key={`brand-rate-${row.category}`} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                          <td className="border-b border-r border-slate-200 px-3 py-2 text-left font-medium text-slate-800">
                            {row.category}
                          </td>
                          {SALES_BRANDS.map((brand) => (
                            <td
                              key={`brand-rate-${row.category}-${brand}`}
                              className="border-b border-r border-slate-200 px-3 py-2 text-center text-slate-700 last:border-r-0"
                            >
                              {row.rates[brand]}%
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50/85 shadow-sm">
          <button
            type="button"
            onClick={() => setDirectExpenseRatioSectionOpen((prev) => !prev)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left"
          >
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-[#6b7a8f] text-xs text-white">
              직
            </span>
            <div className="flex-1 flex items-center gap-6">
              <div className="shrink-0">
                <div className="text-sm font-semibold text-slate-800">직접비율 보조지표 🟢Live</div>
                <div className="text-xs text-slate-500">실적월까지 공백, 익월부터 12월까지 CSV 원천값 표시</div>
              </div>
              <div className="text-left text-xs text-slate-800 leading-relaxed">
                <div className="font-mono font-semibold text-blue-600 mb-0.5">보조파일(simu)/pl_brand_forecast_직접비율/{'{브랜드}'}.csv</div>
                <div>변동비: CSV 비율 × 실판매출 → PL 직접비 반영 (급여(매장), 복리후생비(매장), 플랫폼수수료, TP수수료, 직접광고비, 물류비, 매장임차료)</div>
                <div>고정비: CSV 금액 그대로 반영 (대리상지원금, 감가상각비, 기타(직접비))</div>
                <div>실적월은 공백 (실적값 우선), 익월부터 CSV 적용</div>
              </div>
            </div>
            <div className="text-xs text-slate-500">
              {directExpenseRatioLoading
                ? '불러오는 중...'
                : directExpenseRatioError
                  ? '오류'
                  : latestActualMonth > 0
                    ? `실적월 ${latestActualMonth}월 기준`
                    : '실적 파일 없음'}
            </div>
            <span className="text-xs text-slate-500">{directExpenseRatioSectionOpen ? '접기' : '펼치기'}</span>
          </button>

          {directExpenseRatioSectionOpen && (
            <>
              {directExpenseRatioError ? (
                <div className="border-t border-slate-200 px-4 py-4 text-sm text-red-500">{directExpenseRatioError}</div>
              ) : (
                <div className="border-t border-slate-200 p-4">
                  <div className="overflow-auto rounded-xl border border-slate-200 bg-white">
                    <table className="w-full border-separate border-spacing-0 text-sm">
                      <thead className="sticky top-0 z-10">
                        <tr>
                          <th className="min-w-[180px] border-b border-r border-slate-300 bg-slate-800 px-3 py-2 text-center font-semibold text-slate-100">
                            구분
                          </th>
                          <th className="min-w-[100px] border-b border-r border-slate-300 bg-slate-800 px-3 py-2 text-center font-semibold text-slate-100">
                            고정/변동 구분
                          </th>
                          {MONTH_HEADERS.map((month) => (
                            <th
                              key={`direct-expense-ratio-${month}`}
                              className="min-w-[92px] border-b border-r border-slate-300 bg-slate-800 px-3 py-2 text-center font-semibold text-slate-100 last:border-r-0"
                            >
                              {month}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {SALES_BRANDS.map((brand) => (
                          <Fragment key={`direct-expense-ratio-group-${brand}`}>
                            <tr key={`direct-expense-ratio-brand-${brand}`} className="bg-slate-100">
                              <td className="border-b border-r border-slate-200 px-3 py-2 font-semibold text-slate-800">{brand}</td>
                              <td className="border-b border-r border-slate-200 px-3 py-2" />
                              {MONTH_HEADERS.map((_, monthIndex) => (
                                <td
                                  key={`direct-expense-ratio-brand-${brand}-${monthIndex}`}
                                  className="border-b border-r border-slate-200 px-3 py-2 last:border-r-0"
                                />
                              ))}
                            </tr>
                            {DIRECT_EXPENSE_ACCOUNTS.map((account, accountIndex) => {
                              const series = directExpenseRatioByBrand[brand]?.[account] ?? new Array(12).fill(null);
                              return (
                                <tr
                                  key={`direct-expense-ratio-${brand}-${account}`}
                                  className={accountIndex % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}
                                >
                                  <td className="border-b border-r border-slate-200 px-3 py-2 pl-7 text-slate-700">{account}</td>
                                  <td className="border-b border-r border-slate-200 px-3 py-2 text-center text-slate-600">
                                    {FIXED_COST_ACCOUNTS.has(account) ? '고정비' : '변동비'}
                                  </td>
                                  {MONTH_HEADERS.map((_, monthIndex) => {
                                    const hiddenByActual = monthIndex + 1 <= latestActualMonth;
                                    const value = hiddenByActual ? null : (series[monthIndex] ?? null);
                                    return (
                                      <td
                                        key={`direct-expense-ratio-${brand}-${account}-${monthIndex}`}
                                        className="border-b border-r border-slate-200 px-3 py-2 text-right text-slate-700 last:border-r-0"
                                      >
                                        {FIXED_COST_ACCOUNTS.has(account) ? formatKAmount(value) : formatPercent3(value)}
                                      </td>
                                    );
                                  })}
                                </tr>
                              );
                            })}
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50/85 shadow-sm">
          <button
            type="button"
            onClick={() => setTagCostRatioSectionOpen((prev) => !prev)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left"
          >
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-[#7b6a58] text-xs text-white">
              원
            </span>
            <div className="flex-1 flex items-center gap-6">
              <div className="shrink-0">
                <div className="text-sm font-semibold text-slate-800">Tag대비원가율 보조지표 🟢Live</div>
                <div className="text-xs text-slate-500">실적월까지 공백, 익월부터 12월까지 CSV 원천값 표시</div>
              </div>
              <div className="font-mono font-semibold text-blue-600 text-xs">보조파일(simu)/Tag대비원가율.csv</div>
            </div>
            <div className="text-xs text-slate-500">
              {tagCostRatioLoading
                ? '불러오는 중...'
                : tagCostRatioError
                  ? '오류'
                  : latestActualMonth > 0
                    ? `실적월 ${latestActualMonth}월 기준`
                    : '실적 파일 없음'}
            </div>
            <span className="text-xs text-slate-500">{tagCostRatioSectionOpen ? '접기' : '펼치기'}</span>
          </button>

          {tagCostRatioSectionOpen && (
            <>
              {tagCostRatioError ? (
                <div className="border-t border-slate-200 px-4 py-4 text-sm text-red-500">{tagCostRatioError}</div>
              ) : (
                <div className="border-t border-slate-200 p-4">
                  <div className="overflow-auto rounded-xl border border-slate-200 bg-white">
                    <table className="w-full border-separate border-spacing-0 text-sm">
                      <thead className="sticky top-0 z-10">
                        <tr>
                          <th className="min-w-[180px] border-b border-r border-slate-300 bg-slate-800 px-3 py-2 text-center font-semibold text-slate-100">
                            구분
                          </th>
                          {MONTH_HEADERS.map((month) => (
                            <th
                              key={`tag-cost-ratio-${month}`}
                              className="min-w-[92px] border-b border-r border-slate-300 bg-slate-800 px-3 py-2 text-center font-semibold text-slate-100 last:border-r-0"
                            >
                              {month}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {SALES_BRANDS.map((brand, idx) => {
                          const series = tagCostRatioByBrand[brand] ?? new Array(12).fill(null);
                          return (
                            <tr key={`tag-cost-ratio-${brand}`} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                              <td className="border-b border-r border-slate-200 px-3 py-2 font-medium text-slate-800">{brand}</td>
                              {MONTH_HEADERS.map((_, monthIndex) => {
                                const hiddenByActual = monthIndex + 1 <= latestActualMonth;
                                const value = hiddenByActual ? null : (series[monthIndex] ?? null);
                                return (
                                  <td
                                    key={`tag-cost-ratio-${brand}-${monthIndex}`}
                                    className="border-b border-r border-slate-200 px-3 py-2 text-right text-slate-700 last:border-r-0"
                                  >
                                    {formatPercent3(value)}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* ─── 전년 할인율 보조지표 ─────────────────────────────────────────────── */}
        <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50/85 shadow-sm">
          <button
            type="button"
            onClick={() => setPrevYearDiscountSectionOpen((prev) => !prev)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left"
          >
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-[#5a7a4a] text-xs text-white">
              할
            </span>
            <div className="flex-1 flex items-center gap-6">
              <div className="shrink-0">
                <div className="text-sm font-semibold text-slate-800">전년 할인율 🟢Live</div>
                <div className="text-xs text-slate-500">실적월까지 공백, 익월부터 12월까지 CSV 원천값 표시</div>
              </div>
              <div className="font-mono font-semibold text-blue-600 text-xs">보조파일(simu)/전년할인율.csv</div>
            </div>
            <div className="text-xs text-slate-500">
              {prevYearDiscountLoading
                ? '불러오는 중...'
                : prevYearDiscountError
                  ? '오류'
                  : latestActualMonth > 0
                    ? `실적월 ${latestActualMonth}월 기준`
                    : '실적 파일 없음'}
            </div>
            <span className="text-xs text-slate-500">{prevYearDiscountSectionOpen ? '접기' : '펼치기'}</span>
          </button>

          {prevYearDiscountSectionOpen && (
            <>
              {prevYearDiscountError ? (
                <div className="border-t border-slate-200 px-4 py-4 text-sm text-red-500">{prevYearDiscountError}</div>
              ) : (
                <div className="border-t border-slate-200 p-4">
                  <div className="overflow-auto rounded-xl border border-slate-200 bg-white">
                    <table className="w-full border-separate border-spacing-0 text-sm">
                      <thead className="sticky top-0 z-10">
                        <tr>
                          <th className="min-w-[180px] border-b border-r border-slate-300 bg-slate-800 px-3 py-2 text-center font-semibold text-slate-100">
                            구분
                          </th>
                          {MONTH_HEADERS.map((month) => (
                            <th
                              key={`prev-discount-${month}`}
                              className="min-w-[92px] border-b border-r border-slate-300 bg-slate-800 px-3 py-2 text-center font-semibold text-slate-100 last:border-r-0"
                            >
                              {month}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {SALES_BRANDS.map((brand) => (
                          <Fragment key={`prev-discount-group-${brand}`}>
                            <tr className="bg-slate-100">
                              <td className="border-b border-r border-slate-200 px-3 py-2 font-semibold text-slate-800">{brand}</td>
                              {MONTH_HEADERS.map((_, mi) => (
                                <td key={`prev-discount-brand-${brand}-${mi}`} className="border-b border-r border-slate-200 px-3 py-2 last:border-r-0" />
                              ))}
                            </tr>
                            {(['대리상', '직영'] as const).map((channel, ci) => {
                              const key = channel === '대리상' ? 'dealer' : 'direct';
                              const series = prevYearDiscountByBrand[brand]?.[key] ?? new Array(12).fill(null);
                              return (
                                <tr key={`prev-discount-${brand}-${channel}`} className={ci % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                                  <td className="border-b border-r border-slate-200 px-3 py-2 pl-7 text-slate-700">{channel}</td>
                                  {MONTH_HEADERS.map((_, monthIndex) => {
                                    const hiddenByActual = monthIndex + 1 <= latestActualMonth;
                                    const value = hiddenByActual ? null : (series[monthIndex] ?? null);
                                    return (
                                      <td
                                        key={`prev-discount-${brand}-${channel}-${monthIndex}`}
                                        className="border-b border-r border-slate-200 px-3 py-2 text-right text-slate-700 last:border-r-0"
                                      >
                                        {formatPercent3(value)}
                                      </td>
                                    );
                                  })}
                                </tr>
                              );
                            })}
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

    {/* ─── 시나리오 비교 모달 ──────────────────────────────────────────────────── */}
    {scenarioModalOpen && (
      <div
        className="fixed inset-0 z-[100] flex items-stretch justify-center bg-black/60 backdrop-blur-sm"
        onClick={() => setScenarioModalOpen(false)}
      >
        <div
          className="flex w-full flex-col overflow-hidden rounded-none bg-white shadow-2xl md:m-4 md:rounded-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* 모달 헤더 */}
          <div className="flex shrink-0 items-center justify-between bg-gradient-to-r from-[#1e3a5f] to-[#3b5f93] px-6 py-4 text-white">
            <div>
              <div className="text-lg font-bold tracking-tight">시나리오 PL 비교</div>
              <div className="text-xs opacity-70">3개 시나리오 연간 PL 비교 (FY26, CNY K)</div>
            </div>
            <div className="flex items-center gap-2">
              {process.env.NODE_ENV === 'development' && (
                <button
                  type="button"
                  onClick={() => { void openScenarioModal(true); }}
                  disabled={scenarioLoading}
                  className="rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/20 disabled:opacity-40"
                >
                  🔄 재계산
                </button>
              )}
              <button
                type="button"
                onClick={() => setScenarioModalOpen(false)}
                className="rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/20"
              >
                ✕ 닫기
              </button>
            </div>
          </div>

          {/* 성장률 기준 정보 */}
          <div className="shrink-0 border-b border-slate-200 bg-slate-50 px-6 py-3">
            <div className="grid grid-cols-3 gap-3">
              {SCENARIO_ORDER.map((scKey) => {
                const def = SCENARIO_DEFS[scKey];
                return (
                  <div key={scKey} className="rounded-xl border p-3" style={{ borderColor: def.borderColor, background: def.bgColor }}>
                    <div className="mb-2 text-sm font-bold" style={{ color: def.color }}>
                      {def.label} <span className="text-xs font-normal text-slate-500">(대리상, 직영 성장률)</span>
                    </div>
                    <table className="w-full text-[12px]">
                      <thead>
                        <tr>
                          <th className="pb-1 text-left font-medium text-slate-500">브랜드</th>
                          <th className="pb-1 text-center font-medium text-slate-500">대리상</th>
                          <th className="pb-1 text-center font-medium text-slate-500">직영</th>
                        </tr>
                      </thead>
                      <tbody>
                        {SALES_BRANDS.map((brand) => (
                          <tr key={brand}>
                            <td className="py-0.5 pr-2 font-semibold text-slate-700">{brand}</td>
                            <td className="py-0.5 text-center font-mono text-slate-700">
                              {100 + effectiveScenarioGrowthRates[scKey].dealer[brand]}%
                            </td>
                            <td className="py-0.5 text-center font-mono text-slate-700">
                              {100 + effectiveScenarioGrowthRates[scKey].hq[brand]}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 브랜드 탭 — 높이·타이포를 요약/전체 PL 토글과 맞춘 컴팩트 스타일 */}
          <div className="shrink-0 border-b border-slate-200 bg-white px-6 py-2">
            <div className="flex items-center justify-between gap-3">
            <div className="inline-flex flex-wrap gap-0.5 rounded-lg border border-slate-200 bg-white p-0.5 text-xs shadow-sm">
              {FORECAST_BRANDS.map((brand) => {
                const selected = scenarioModalBrand === brand.id;
                return (
                  <button
                    key={brand.id ?? 'corp'}
                    type="button"
                    onClick={() => setScenarioModalBrand(brand.id)}
                    className={`group relative overflow-hidden rounded-md px-3 py-1.5 font-semibold tracking-[-0.01em] transition-colors ${
                      selected
                        ? 'bg-[linear-gradient(135deg,#1f3b5b_0%,#355b88_55%,#4d78a9_100%)] text-white shadow-sm ring-1 ring-slate-300/25'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                    }`}
                  >
                    <span
                      className={`pointer-events-none absolute inset-0 transition-opacity duration-200 ${
                        selected ? 'bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.2),transparent_58%)] opacity-100' : 'bg-[radial-gradient(circle_at_top,rgba(148,163,184,0.12),transparent_58%)] opacity-0 group-hover:opacity-100'
                      }`}
                    />
                    <span className="relative z-10">{brand.label}</span>
                  </button>
                );
              })}
            </div>
            {/* 요약 / 전체 PL 토글 */}
            <div className="inline-flex overflow-hidden rounded-lg border border-slate-200 bg-white text-xs shadow-sm">
              <button
                type="button"
                onClick={() => setScenarioViewMode('summary')}
                className={`px-3 py-1.5 font-semibold transition-colors ${
                  scenarioViewMode === 'summary'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                요약
              </button>
              <button
                type="button"
                onClick={() => setScenarioViewMode('full')}
                className={`border-l border-slate-200 px-3 py-1.5 font-semibold transition-colors ${
                  scenarioViewMode === 'full'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                전체 PL
              </button>
            </div>
            </div>
          </div>

          {/* 비교 테이블 */}
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="px-6 py-3">
            {scenarioLoading ? (
              <div className="flex h-full items-center justify-center py-20">
                <div className="text-center">
                  <div className="mb-3 text-4xl">⏳</div>
                  <div className="text-sm font-semibold text-slate-700">시나리오 계산 중...</div>
                  <div className="mt-1 text-xs text-slate-500">9개 API 호출 + PL 파이프라인 재계산</div>
                </div>
              </div>
            ) : scenarioError ? (
              <div className="flex h-full items-center justify-center py-20">
                <div className="text-center">
                  <div className="mb-3 text-4xl">❌</div>
                  <div className="text-sm font-semibold text-red-600">{scenarioError}</div>
                  <button
                    type="button"
                    onClick={() => void openScenarioModal()}
                    className="mt-3 rounded-lg bg-red-50 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100"
                  >
                    다시 시도
                  </button>
                </div>
              </div>
            ) : scenarioData ? (() => {
                // YOY 포맷 헬퍼
                const fmtYoy = (annual26: number | null, annual25: number | null, fmt?: 'number' | 'percent'): string => {
                  if (fmt === 'percent') {
                    if (annual26 === null || annual25 === null) return '-';
                    const diff = (annual26 - annual25) * 100;
                    return `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%p`;
                  }
                  if (annual26 === null || annual25 === null || annual25 === 0) return '-';
                  return `${((annual26 / annual25) * 100).toFixed(1)}%`;
                };
                const fmtK = (v: number | null) =>
                  v === null ? '-' : Math.round(v).toLocaleString();
                const fmtYoyWc = (val: number | null, base: number | null) => {
                  if (val === null || base === null) return '-';
                  const diff = Math.round(val - base);
                  const body = diff.toLocaleString();
                  return diff > 0 ? `+${body}` : body;
                };
                const netCashRowCbd = scenarioCfRows?.find((r) => r.account === 'net cash') ?? null;
                const ncBaseYuanCbd = netCashRowCbd ? cfPlan26Yuan(netCashRowCbd) : null;
                const borrowRowCbd = scenarioCfRows?.find((r) => r.account === '차입금' && r.level === 0) ?? null;
                const borrowPlYuanCbd = borrowRowCbd ? cfPlan26Yuan(borrowRowCbd) : null;
                const scenarioCbdClosingK: Partial<Record<ScenarioKey, { cash: number; debt: number }>> = {};
                for (const sk of SCENARIO_ORDER) {
                  if (sk === 'base') continue;
                  const pair = cfScenarioCbdClosingPairK(
                    scenarioCfRows,
                    sk,
                    scenarioData,
                    scenarioCashBorrowPlanK?.cash ?? null,
                    scenarioCashBorrowPlanK?.debt ?? null,
                    ncBaseYuanCbd,
                    borrowPlYuanCbd,
                  );
                  if (pair) scenarioCbdClosingK[sk] = pair;
                }
                return (
                  <Fragment>
                  <table className="mb-6 w-full border border-slate-200 border-separate border-spacing-0 text-xs">
                    {/* ── 헤더 ── */}
                    <thead className="sticky top-0 z-20">
                      <tr>
                        {/* 계정과목 */}
                        <th className="sticky left-0 z-30 min-w-[200px] border-b border-r border-slate-200 bg-gradient-to-r from-[#2f4f7f] to-[#3b5f93] px-3 py-2.5 text-center font-semibold text-white">
                          손익계산서
                        </th>
                        {/* 2025 실적 — 운전자본·현금흐름과 동일 min-w */}
                        <th className="min-w-[88px] border-b border-b-slate-200 border-r border-r-slate-200 bg-slate-700 px-3 py-2.5 text-center font-semibold text-slate-100">
                          2025실적
                        </th>
                        {/* 시나리오별 헤더 */}
                        {SCENARIO_ORDER.map((scKey) => {
                          const def = SCENARIO_DEFS[scKey];
                          const hBg = def.headerBgColor ?? def.bgColor;
                          const hColor = def.headerColor ?? def.color;
                          const isScExpanded = scenarioExpandedScenarios.has(scKey);
                          const showVsBasePl = scKey === 'negative' || scKey === 'positive';
                          if (isScExpanded) {
                            return (
                              <Fragment key={scKey}>
                                {MONTH_HEADERS.map((m) => (
                                  <th
                                    key={m}
                                    className="min-w-[70px] border-b border-r border-slate-200 px-2 py-2.5 text-center font-medium"
                                    style={{ background: hBg, color: hColor }}
                                  >
                                    {m}
                                  </th>
                                ))}
                                {/* 연간 + 토글 */}
                                <th
                                  className={`min-w-[88px] border-b border-b-slate-200 px-2 py-2.5 text-center font-bold ${SCENARIO_COL_DIVIDER_THIN_R}`}
                                  style={{ background: hBg, color: hColor }}
                                >
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setScenarioExpandedScenarios((prev) => {
                                        const next = new Set(prev);
                                        next.delete(scKey);
                                        return next;
                                      })
                                    }
                                    className="flex w-full items-center justify-center gap-1 font-bold"
                                    style={{ color: hColor }}
                                  >
                                    {def.label} ▼
                                  </button>
                                </th>
                                {/* YOY */}
                                <th
                                  className={`min-w-[76px] border-b border-b-slate-200 px-2 py-2.5 text-center font-medium ${showVsBasePl ? SCENARIO_COL_DIVIDER_THIN_R : SCENARIO_COL_DIVIDER_BLK_R}`}
                                  style={{ background: hBg, color: hColor }}
                                >
                                  YOY
                                </th>
                                {showVsBasePl && (
                                  <th
                                    className={`min-w-[76px] border-b border-b-slate-200 px-2 py-2.5 text-center font-medium ${SCENARIO_COL_DIVIDER_BLK_R}`}
                                    style={{ background: hBg, color: hColor }}
                                  >
                                    기존계획대비
                                  </th>
                                )}
                              </Fragment>
                            );
                          }
                          return (
                            <Fragment key={scKey}>
                              {/* 연간 + 토글 */}
                              <th
                                className={`min-w-[88px] border-b border-b-slate-200 px-2 py-2.5 text-center font-bold ${SCENARIO_COL_DIVIDER_THIN_R}`}
                                style={{ background: hBg, color: hColor }}
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    setScenarioExpandedScenarios((prev) => new Set([...prev, scKey]))
                                  }
                                  className="flex w-full items-center justify-center gap-1 font-bold"
                                  style={{ color: hColor }}
                                >
                                  {def.label} ▶
                                </button>
                              </th>
                              {/* YOY */}
                              <th
                                className={`min-w-[76px] border-b border-b-slate-200 px-2 py-2.5 text-center font-medium ${showVsBasePl ? SCENARIO_COL_DIVIDER_THIN_R : SCENARIO_COL_DIVIDER_BLK_R}`}
                                style={{ background: hBg, color: hColor }}
                              >
                                YOY
                              </th>
                              {showVsBasePl && (
                                <th
                                  className={`min-w-[76px] border-b border-b-slate-200 px-2 py-2.5 text-center font-medium ${SCENARIO_COL_DIVIDER_BLK_R}`}
                                  style={{ background: hBg, color: hColor }}
                                >
                                  기존계획대비
                                </th>
                              )}
                            </Fragment>
                          );
                        })}
                      </tr>
                    </thead>

                    {/* ── 바디 ── */}
                    <tbody>
                      {scenarioVisibleRows.map((row, rowIdx) => {
                        const annual2025 = (() => {
                          if (row.account === '실판매출(V+)') {
                            const vMinus = scenarioModalBrand === null
                              ? scenarioData.base.corporate.calculated.annual2025['실판매출'] ?? null
                              : scenarioData.base.byBrand[scenarioModalBrand as ForecastLeafBrand].calculated.annual2025['실판매출'] ?? null;
                            return vMinus === null ? null : vMinus * 1.13;
                          }
                          if (row.account === '리테일매출' || row.account === '리테일매출_대리상' || row.account === '리테일매출_직영') {
                            if (scenarioModalBrand === null) {
                              if (row.account === '리테일매출') return (['MLB', 'MLB KIDS', 'DISCOVERY'] as SalesBrand[]).reduce((s, b) => s + RETAIL_ANNUAL_2025[b].dealer + RETAIL_ANNUAL_2025[b].direct, 0);
                              if (row.account === '리테일매출_대리상') return (['MLB', 'MLB KIDS', 'DISCOVERY'] as SalesBrand[]).reduce((s, b) => s + RETAIL_ANNUAL_2025[b].dealer, 0);
                              return (['MLB', 'MLB KIDS', 'DISCOVERY'] as SalesBrand[]).reduce((s, b) => s + RETAIL_ANNUAL_2025[b].direct, 0);
                            }
                            const sb = FORECAST_TO_SALES_BRAND[scenarioModalBrand as ForecastLeafBrand];
                            const r25 = RETAIL_ANNUAL_2025[sb];
                            if (row.account === '리테일매출') return r25.dealer + r25.direct;
                            if (row.account === '리테일매출_대리상') return r25.dealer;
                            return r25.direct;
                          }
                          return scenarioModalBrand === null
                            ? scenarioData.base.corporate.calculated.annual2025[row.account] ?? null
                            : scenarioData.base.byBrand[scenarioModalBrand as ForecastLeafBrand].calculated.annual2025[row.account] ?? null;
                        })();
                        const annual26BasePlan = getScenarioAnnual26(row.account, scenarioModalBrand, scenarioData.base);
                        const isHighlightRow = row.account === '리테일매출' || row.account === '영업이익률(관리식)' || row.account === '영업이익률(재무식)';
                        const bgClass = isHighlightRow ? 'bg-slate-100' : 'bg-white';
                        const isBoldRow = row.isBold ?? row.isGroup;
                        const isAccCollapsed = row.isGroup && scenarioCollapsedAccounts.has(row.account);

                        return (
                          <tr key={row.account} className={bgClass}>
                            {/* 계정과목 (계층 토글) */}
                            <td
                              className={`sticky left-0 z-10 border-b border-r border-slate-200 py-2 ${bgClass} ${isBoldRow ? 'font-semibold text-slate-800' : 'font-normal text-slate-700'}`}
                              style={{ paddingLeft: `${16 + row.level * 18}px`, paddingRight: '10px' }}
                            >
                              {row.isGroup ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setScenarioCollapsedAccounts((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(row.account)) next.delete(row.account);
                                      else next.add(row.account);
                                      return next;
                                    })
                                  }
                                  className="flex items-center gap-1 text-left w-full"
                                >
                                  <span className="text-[9px] text-slate-400">{isAccCollapsed ? '▶' : '▼'}</span>
                                  <span>{ACCOUNT_LABEL_OVERRIDES[row.account] ?? row.account}</span>
                                </button>
                              ) : (
                                <span>{ACCOUNT_LABEL_OVERRIDES[row.account] ?? row.account}</span>
                              )}
                            </td>

                            {/* 2025 실적 */}
                            <td className="border-b border-b-slate-200 border-r border-r-slate-200 px-3 py-2 text-right text-slate-500">
                              {formatValue(annual2025, row.format)}
                            </td>

                            {/* 시나리오별 데이터 */}
                            {SCENARIO_ORDER.map((scKey) => {
                              const def = SCENARIO_DEFS[scKey];
                              const isScExpanded = scenarioExpandedScenarios.has(scKey);
                              const showVsBasePl = scKey === 'negative' || scKey === 'positive';
                              const annual26 = getScenarioAnnual26(row.account, scenarioModalBrand, scenarioData[scKey]);
                              const yoyStr = fmtYoy(annual26, annual2025, row.format);
                              const vsBaseStr = fmtVsBasePl(annual26, annual26BasePlan, row.format);

                              if (isScExpanded) {
                                const monthly = getScenarioRowSeries(row.account, scenarioModalBrand, scenarioData[scKey]);
                                return (
                                  <Fragment key={scKey}>
                                    {monthly.map((v, i) => (
                                      <td
                                        key={i}
                                        className="border-b border-r border-slate-200 px-2 py-2 text-right text-slate-700"
                                      >
                                        {formatValue(v, row.format)}
                                      </td>
                                    ))}
                                    {/* 연간 */}
                                    <td
                                      className={`border-b border-b-slate-200 px-2 py-2 text-right ${SCENARIO_COL_DIVIDER_THIN_R} ${isBoldRow ? 'font-semibold' : 'font-medium'}`}
                                      style={{ color: def.color, background: def.bgColor }}
                                    >
                                      {formatValue(annual26, row.format)}
                                    </td>
                                    {/* YOY */}
                                    <td
                                      className={`border-b border-b-slate-200 px-2 py-2 text-right font-medium ${showVsBasePl ? SCENARIO_COL_DIVIDER_THIN_R : SCENARIO_COL_DIVIDER_BLK_R}`}
                                      style={{ color: def.color, background: def.bgColor }}
                                    >
                                      {yoyStr}
                                    </td>
                                    {showVsBasePl && (
                                      <td
                                        className={`border-b border-b-slate-200 px-2 py-2 text-right text-slate-500 ${SCENARIO_COL_DIVIDER_BLK_R}`}
                                        style={{ background: def.bgColor }}
                                      >
                                        {vsBaseStr}
                                      </td>
                                    )}
                                  </Fragment>
                                );
                              }

                              return (
                                <Fragment key={scKey}>
                                  {/* 연간 */}
                                  <td
                                    className={`border-b border-b-slate-200 px-3 py-2 text-right ${SCENARIO_COL_DIVIDER_THIN_R} ${isBoldRow ? 'font-semibold' : 'font-medium'}`}
                                    style={{ color: def.color }}
                                  >
                                    {formatValue(annual26, row.format)}
                                  </td>
                                  {/* YOY */}
                                  <td
                                    className={`border-b border-b-slate-200 px-3 py-2 text-right text-slate-500 ${showVsBasePl ? SCENARIO_COL_DIVIDER_THIN_R : SCENARIO_COL_DIVIDER_BLK_R}`}
                                  >
                                    {yoyStr}
                                  </td>
                                  {showVsBasePl && (
                                    <td
                                      className={`border-b border-b-slate-200 px-3 py-2 text-right text-slate-500 ${SCENARIO_COL_DIVIDER_BLK_R}`}
                                    >
                                      {vsBaseStr}
                                    </td>
                                  )}
                                </Fragment>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  {/* 운전자본표: 법인 전체 · 요약/전체 PL 전환과 무관하게 항상 표시 */}
                  {(() => {
                    const wc = scenarioWcData;
                    const WC_ROWS: { key: keyof ScenarioWcRow; label: string; isGroup: boolean; isBrand?: SalesBrand }[] = [
                      { key: 'total', label: '운전자본합계', isGroup: true },
                      { key: 'ar', label: '매출채권', isGroup: false },
                      { key: 'inventory', label: '재고자산', isGroup: true },
                      { key: 'inventory', label: 'MLB', isGroup: false, isBrand: 'MLB' },
                      { key: 'inventory', label: 'MLB KIDS', isGroup: false, isBrand: 'MLB KIDS' },
                      { key: 'inventory', label: 'DISCOVERY', isGroup: false, isBrand: 'DISCOVERY' },
                      { key: 'ap', label: '매입채무', isGroup: false },
                    ];
                    return (
                      <div className="mb-6">
                        {wc?.invDataMissing && (
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 border border-amber-200">
                              ⚠ 재고 미계산 — 재고자산(sim) 탭에서 재계산·저장 버튼을 눌러주세요
                            </span>
                          </div>
                        )}
                        <table className="w-full border border-slate-200 border-separate border-spacing-0 text-xs">
                          <thead className="sticky top-0 z-20">
                            <tr>
                              <th className="sticky left-0 z-30 min-w-[200px] border-b border-r border-slate-200 bg-gradient-to-r from-[#2f4f7f] to-[#3b5f93] px-3 py-2.5 text-center font-semibold text-white">
                                운전자본표 (법인전체, K단위)
                              </th>
                              <th className="min-w-[88px] border-b border-b-slate-200 border-r border-r-slate-200 bg-slate-700 px-3 py-2.5 text-center font-semibold text-slate-100">
                                2025실적
                              </th>
                              {SCENARIO_ORDER.map((scKey) => {
                                const def = SCENARIO_DEFS[scKey];
                                const wcHBg = def.headerBgColor ?? def.bgColor;
                                const wcHColor = def.headerColor ?? def.color;
                                const isBase = scKey === 'base';
                                return (
                                  <Fragment key={scKey}>
                                    <th
                                      className={`min-w-[88px] border-b border-b-slate-200 px-2 py-2.5 text-center font-bold ${SCENARIO_COL_DIVIDER_THIN_R}`}
                                      style={{ background: wcHBg, color: wcHColor }}
                                    >
                                      {def.label}
                                    </th>
                                    <th
                                      className={`min-w-[76px] border-b border-b-slate-200 px-2 py-2.5 text-center font-medium ${!isBase ? SCENARIO_COL_DIVIDER_THIN_R : SCENARIO_COL_DIVIDER_BLK_R}`}
                                      style={{ background: wcHBg, color: wcHColor }}
                                    >
                                      전년대비
                                    </th>
                                    {!isBase && (
                                      <th
                                        className={`min-w-[76px] border-b border-b-slate-200 px-2 py-2.5 text-center font-medium ${scKey === 'positive' ? 'border-r-0' : SCENARIO_COL_DIVIDER_BLK_R}`}
                                        style={{ background: wcHBg, color: wcHColor }}
                                      >
                                        기존계획대비
                                      </th>
                                    )}
                                  </Fragment>
                                );
                              })}
                            </tr>
                          </thead>
                          <tbody>
                            {WC_ROWS.map((row, rowIdx) => {
                              const isBrandRow = !!row.isBrand;
                              if (isBrandRow && !wcInvBrandOpen) return null;
                              // 2025 실적: 브랜드 행은 hardcoded (CF(sim) 기준, K CNY)
                              const ACTUAL2025_INV_BY_BRAND: Record<SalesBrand, number> = {
                                MLB: 1260042, 'MLB KIDS': 66326, DISCOVERY: 171427,
                              };
                              const actual25: number | null = isBrandRow
                                ? (ACTUAL2025_INV_BY_BRAND[row.isBrand!] ?? null)
                                : ((wc?.actual2025[row.key] as number | null) ?? null);

                              return (
                                <tr
                                  key={`${row.key}-${row.label}-${rowIdx}`}
                                  className={row.key === 'total' && row.isGroup ? 'bg-amber-50' : 'bg-white'}
                                >
                                  <td className={`sticky left-0 z-10 border-b border-r border-slate-200 bg-inherit py-2 text-slate-800 ${row.isGroup ? 'font-semibold' : isBrandRow ? 'pl-8 text-[11px] text-slate-500' : 'font-normal text-slate-700'}`} style={{ paddingLeft: isBrandRow ? undefined : '10px', paddingRight: '10px' }}>
                                    {row.key === 'inventory' && row.isGroup ? (
                                      <button
                                        type="button"
                                        className="flex w-full items-center justify-between hover:text-slate-600"
                                        onClick={() => setWcInvBrandOpen((v) => !v)}
                                      >
                                        <span>{row.label}</span>
                                        <span className="text-[10px] font-normal text-slate-400">{wcInvBrandOpen ? '▼ 접기' : '▶ 상세'}</span>
                                      </button>
                                    ) : row.label}
                                  </td>
                                  <td className={`border-b border-b-slate-200 border-r border-r-slate-200 px-3 py-2 text-right text-slate-500 ${isBrandRow ? 'text-[11px]' : ''}`}>
                                    {fmtK(actual25)}
                                  </td>
                                  {SCENARIO_ORDER.map((scKey) => {
                                    const def = SCENARIO_DEFS[scKey];
                                    let val: number | null = null;
                                    let basePlanK: number | null = null;
                                    let tooltipText: string | undefined;

                                    if (isBrandRow) {
                                      const bd = wc?.scenarios[scKey].inventoryByBrand?.[row.isBrand!];
                                      val = bd?.costK ?? null;
                                      const bdBase = wc?.scenarios.base.inventoryByBrand?.[row.isBrand!];
                                      basePlanK = bdBase?.costK ?? null;
                                      if (bd) {
                                        tooltipText = `TAG: ${Math.round(bd.tagK).toLocaleString()}K · 원가율: ${(bd.costRatio * 100).toFixed(1)}% · 평가감: ${(bd.valRate * 100).toFixed(1)}%`;
                                      }
                                    } else {
                                      val = (wc?.scenarios[scKey][row.key] as number | null) ?? null;
                                      basePlanK = (wc?.scenarios.base[row.key] as number | null) ?? null;
                                    }

                                    return (
                                      <Fragment key={scKey}>
                                        <td
                                          className={`border-b border-b-slate-200 px-3 py-2 text-right ${SCENARIO_COL_DIVIDER_THIN_R} ${row.isGroup ? 'font-semibold' : isBrandRow ? 'text-[11px] text-slate-500' : 'font-medium'}`}
                                          style={!isBrandRow ? { color: def.color } : undefined}
                                          title={tooltipText}
                                        >
                                          {fmtK(val)}
                                        </td>
                                        <td
                                          className={`border-b border-b-slate-200 px-3 py-2 text-right text-slate-500 text-[11px] ${scKey !== 'base' ? SCENARIO_COL_DIVIDER_THIN_R : SCENARIO_COL_DIVIDER_BLK_R}`}
                                        >
                                          {fmtYoyWc(val, actual25)}
                                        </td>
                                        {scKey !== 'base' && (
                                          <td
                                            className={`border-b border-b-slate-200 px-3 py-2 text-right text-slate-500 text-[11px] ${scKey === 'positive' ? 'border-r-0' : SCENARIO_COL_DIVIDER_BLK_R}`}
                                          >
                                            {fmtYoyWc(val, basePlanK)}
                                          </td>
                                        )}
                                      </Fragment>
                                    );
                                  })}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                        <div className="mt-3">
                          <button
                            type="button"
                            onClick={() => setWcLegendOpen((v) => !v)}
                            className="flex w-full items-center gap-2 rounded-md py-1.5 text-left text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            <span className="inline-flex w-4 shrink-0 justify-center text-[10px] text-slate-500 tabular-nums">
                              {wcLegendOpen ? '▼' : '▶'}
                            </span>
                            <span>계산 로직 범례 (부정 / 기존계획 / 긍정)</span>
                          </button>
                          {wcLegendOpen && (
                            <div className="mt-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50/95 px-3 py-2.5 text-[11px] leading-snug text-slate-700">
                              <p className="text-[10px] text-slate-600">
                                <span className="font-semibold text-slate-800">매출채권(K)</span> = 연말기준 AR(K) × (V+해당시나리오 ÷ V+기존계획).{' '}
                                <span className="text-slate-500">
                                  [설명] V+가 기존계획 대비 10% 내려가면, AR도 그 연말 기준 금액 대비 10% 내려갑니다. 직영·대리상을 나눠 따로 감소율을 넣지 않고, 법인 합산
                                  AR 한 덩어리를 매출 규모 비율로만 움직입니다.
                                </span>
                              </p>
                              <p className="text-[10px] text-slate-600">
                                <span className="font-semibold text-slate-800">매입채무(K)</span> = 연말기준 AP(K) × (V+해당시나리오 ÷ V+기존계획).
                              </p>
                              <p className="text-[10px] text-slate-600">
                                <span className="font-semibold text-slate-800">재고자산(K)</span>{' '}
                                = (TAG_K ÷ 1.13) × 원가율 × (1 − 평가감율).{' '}
                                TAG_K는 재고자산(sim)에서 시나리오별로 계산·저장한 브랜드별 기말 TAG 잔액.{' '}
                                원가율 출처: <span className="font-mono text-[10px]">보조파일(simu)/Tag대비원가율.csv</span>.{' '}
                                평가감율(고정): MLB 13.39% / MLB KIDS 27.68% / DISCOVERY 2.25%.{' '}
                                <span className="text-slate-400">※ 브랜드 행에 마우스를 올리면 해당 시나리오의 TAG·원가율·평가감율 확인 가능.</span>
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {/* 현금흐름표 (연간만 · 메인 계층/토글과 동일) */}
                  <div>
                    {scenarioCfError && !scenarioCfRows?.length ? (
                      <div className="rounded-none border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">{scenarioCfError}</div>
                    ) : !scenarioCfRows?.length ? (
                      <div className="rounded-none border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-500">현금흐름표를 불러오는 중…</div>
                    ) : (
                      <>
                        <div className="overflow-x-auto rounded-none">
                          <table className="w-full border border-slate-200 border-separate border-spacing-0 text-xs">
                            <thead className="sticky top-0 z-20">
                              <tr>
                                <th className="sticky left-0 z-30 min-w-[200px] border-b border-r border-slate-200 bg-gradient-to-r from-[#2f4f7f] to-[#3b5f93] px-3 py-2.5 text-left font-semibold text-white">
                                  <div className="flex min-w-0 items-center justify-between gap-2">
                                    <span className="min-w-0 truncate">현금흐름표</span>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (!scenarioCfRows) return;
                                        if (scenarioCfAllCollapsed) {
                                          setScenarioCfCollapsed(new Set());
                                          setScenarioCfAllCollapsed(false);
                                        } else {
                                          const groups = scenarioCfRows
                                            .filter((r) => r.isGroup)
                                            .map((r) => r.account);
                                          const toCollapse = new Set(groups);
                                          toCollapse.add('자산성지출');
                                          setScenarioCfCollapsed(toCollapse);
                                          setScenarioCfAllCollapsed(true);
                                        }
                                      }}
                                      className="shrink-0 rounded-md border border-white/35 bg-white/10 px-2 py-0.5 text-[10px] font-medium text-white shadow-sm hover:bg-white/20"
                                    >
                                      {scenarioCfAllCollapsed ? '펼치기 ▼' : '접기 ▲'}
                                    </button>
                                  </div>
                                </th>
                                <th className="min-w-[88px] border-b border-b-slate-200 border-r border-r-slate-200 bg-slate-700 px-3 py-2.5 text-center font-semibold text-slate-100">
                                  2025년 실적
                                </th>
                                {SCENARIO_ORDER.map((scKey) => {
                                  const def = SCENARIO_DEFS[scKey];
                                  const cfHBg = def.headerBgColor ?? def.bgColor;
                                  const cfHColor = def.headerColor ?? def.color;
                                  const isBase = scKey === 'base';
                                  return (
                                    <Fragment key={`cf-hdr-${scKey}`}>
                                      <th
                                        className={`min-w-[88px] border-b border-b-slate-200 px-2 py-2.5 text-center font-bold ${SCENARIO_COL_DIVIDER_THIN_R}`}
                                        style={{ background: cfHBg, color: cfHColor }}
                                      >
                                        {def.label}
                                      </th>
                                      <th
                                        className={`min-w-[76px] border-b border-b-slate-200 px-2 py-2.5 text-center font-medium ${!isBase ? SCENARIO_COL_DIVIDER_THIN_R : SCENARIO_COL_DIVIDER_BLK_R}`}
                                        style={{ background: cfHBg, color: cfHColor }}
                                      >
                                        전년대비
                                      </th>
                                      {!isBase && (
                                        <th
                                          className={`min-w-[76px] border-b border-b-slate-200 px-2 py-2.5 text-center font-medium ${scKey === 'positive' ? 'border-r-0' : SCENARIO_COL_DIVIDER_BLK_R}`}
                                          style={{ background: cfHBg, color: cfHColor }}
                                        >
                                          기존계획대비
                                        </th>
                                      )}
                                    </Fragment>
                                  );
                                })}
                              </tr>
                            </thead>
                            <tbody>
                              {scenarioCfVisibleRows.map((row, ri) => {
                                const isNetCash = row.account === 'net cash';
                                const isMajor = row.level === 0 && !isNetCash;
                                const indentPx = row.level === 0 ? 12 : row.level === 1 ? 36 : 60;
                                const v = row.values ?? [];
                                const actual25 = Number.isFinite(v[0]) ? v[0] : null;
                                const plan26 = Number.isFinite(v[13]) ? v[13] : null;
                                const rowBg = isNetCash ? 'bg-gray-100' : 'bg-white';
                                const tdSticky = `sticky left-0 z-10 border-b border-r border-slate-200 py-2 px-3 ${rowBg}`;
                                const cfTdNumCore = `border-b border-b-slate-200 py-2 px-2 text-right tabular-nums ${rowBg}`;
                                return (
                                  <tr key={`cf-sc-${ri}-${row.account}`}>
                                    <td className={tdSticky} style={{ paddingLeft: `${indentPx}px` }}>
                                      {row.isGroup ? (
                                        <div className="flex items-center gap-1">
                                          <span className={isMajor ? 'font-semibold text-slate-800' : 'font-medium text-slate-800'}>{row.account}</span>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setScenarioCfCollapsed((prev) => {
                                                const next = new Set(prev);
                                                if (next.has(row.account)) next.delete(row.account);
                                                else next.add(row.account);
                                                return next;
                                              })
                                            }
                                            className="p-0.5 text-[10px] text-slate-500 hover:text-slate-800"
                                          >
                                            {scenarioCfCollapsed.has(row.account) ? '▶' : '▼'}
                                          </button>
                                        </div>
                                      ) : (
                                        <span className={isNetCash ? 'font-semibold text-slate-800' : 'text-slate-800'}>{row.account}</span>
                                      )}
                                    </td>
                                    <td
                                      className={`${cfTdNumCore} border-r border-r-slate-200 ${actual25 != null && actual25 < 0 ? 'text-red-600' : 'text-slate-700'}`}
                                    >
                                      {actual25 != null ? formatScenarioCfAmount(actual25) : '-'}
                                    </td>
                                    {SCENARIO_ORDER.map((scKey) => {
                                      const isBase = scKey === 'base';
                                      const isCfSimExpenseAdjustRow =
                                        row.대분류 === '영업활동' &&
                                        row.중분류 === '비용' &&
                                        row.level === 2 &&
                                        (row.account === SCENARIO_CF_POS_NEG_ADJUST_ACCOUNT ||
                                          row.account === SCENARIO_CF_TAX_ADJUST_ACCOUNT);
                                      if (isBase) {
                                        return (
                                          <Fragment key={`cf-sc-${row.account}-${scKey}`}>
                                            <td
                                              className={`${cfTdNumCore} ${SCENARIO_COL_DIVIDER_THIN_R} ${plan26 != null && plan26 < 0 ? 'text-red-600' : 'text-slate-700'}`}
                                            >
                                              {isCfSimExpenseAdjustRow
                                                ? '-'
                                                : plan26 != null
                                                  ? formatScenarioCfAmount(plan26)
                                                  : '-'}
                                            </td>
                                            <td className={`${cfTdNumCore} ${SCENARIO_COL_DIVIDER_BLK_R} text-slate-600`}>
                                              {isCfSimExpenseAdjustRow ? '-' : formatScenarioCfYoyDiff(plan26, actual25)}
                                            </td>
                                          </Fragment>
                                        );
                                      }
                                      if (
                                        (scKey === 'negative' || scKey === 'positive') &&
                                        row.대분류 === '영업활동' &&
                                        row.account === '비용' &&
                                        row.isGroup &&
                                        row.level === 1
                                      ) {
                                        const adjPn = cfSimPosNegAdjustYuan(scKey, scenarioData);
                                        const adjTax = cfSimCorpTaxAdjustYuan(scKey, scenarioData);
                                        if (plan26 != null && adjPn != null && adjTax != null) {
                                          const expTotal = plan26 + adjPn + adjTax;
                                          return (
                                            <Fragment key={`cf-sc-${row.account}-${scKey}`}>
                                              <td
                                                className={`${cfTdNumCore} ${SCENARIO_COL_DIVIDER_THIN_R} ${expTotal < 0 ? 'text-red-600' : 'text-slate-700'}`}
                                              >
                                                {formatScenarioCfAmount(expTotal)}
                                              </td>
                                              <td className={`${cfTdNumCore} ${SCENARIO_COL_DIVIDER_THIN_R} text-slate-600`}>
                                                {formatScenarioCfYoyDiff(expTotal, actual25)}
                                              </td>
                                              <td
                                                className={`${cfTdNumCore} text-slate-600 ${scKey === 'positive' ? 'border-r-0' : SCENARIO_COL_DIVIDER_BLK_R}`}
                                              >
                                                {formatScenarioCfVsBase(expTotal, plan26)}
                                              </td>
                                            </Fragment>
                                          );
                                        }
                                      }
                                      if ((scKey === 'negative' || scKey === 'positive') && isCfSimExpenseAdjustRow) {
                                        const adjSim =
                                          row.account === SCENARIO_CF_POS_NEG_ADJUST_ACCOUNT
                                            ? cfSimPosNegAdjustYuan(scKey, scenarioData)
                                            : cfSimCorpTaxAdjustYuan(scKey, scenarioData);
                                        if (adjSim != null) {
                                          return (
                                            <Fragment key={`cf-sc-${row.account}-${scKey}`}>
                                              <td
                                                className={`${cfTdNumCore} ${SCENARIO_COL_DIVIDER_THIN_R} ${adjSim < 0 ? 'text-red-600' : 'text-slate-700'}`}
                                              >
                                                {formatScenarioCfAmount(adjSim)}
                                              </td>
                                              <td className={`${cfTdNumCore} ${SCENARIO_COL_DIVIDER_THIN_R} text-slate-600`}>
                                                {formatScenarioCfYoyDiff(adjSim, actual25)}
                                              </td>
                                              <td
                                                className={`${cfTdNumCore} text-slate-600 ${scKey === 'positive' ? 'border-r-0' : SCENARIO_COL_DIVIDER_BLK_R}`}
                                              >
                                                {formatScenarioCfVsBase(adjSim, plan26)}
                                              </td>
                                            </Fragment>
                                          );
                                        }
                                        return (
                                          <Fragment key={`cf-sc-${row.account}-${scKey}`}>
                                            <td className={`${cfTdNumCore} ${SCENARIO_COL_DIVIDER_THIN_R} text-slate-400`}>-</td>
                                            <td className={`${cfTdNumCore} ${SCENARIO_COL_DIVIDER_THIN_R} text-slate-400`}>-</td>
                                            <td
                                              className={`${cfTdNumCore} text-slate-600 ${scKey === 'positive' ? 'border-r-0' : SCENARIO_COL_DIVIDER_BLK_R}`}
                                            >
                                              -
                                            </td>
                                          </Fragment>
                                        );
                                      }
                                      if (
                                        (scKey === 'negative' || scKey === 'positive') &&
                                        row.account === '차입금' &&
                                        row.level === 0 &&
                                        !row.isGroup
                                      ) {
                                        const borrowSc = cfBorrowScenarioFlowYuan(
                                          scenarioCfRows,
                                          scKey,
                                          scenarioData,
                                        );
                                        if (borrowSc != null) {
                                          return (
                                            <Fragment key={`cf-sc-${row.account}-${scKey}`}>
                                              <td
                                                className={`${cfTdNumCore} ${SCENARIO_COL_DIVIDER_THIN_R} ${borrowSc < 0 ? 'text-red-600' : 'text-slate-700'}`}
                                              >
                                                {formatScenarioCfAmount(borrowSc)}
                                              </td>
                                              <td className={`${cfTdNumCore} ${SCENARIO_COL_DIVIDER_THIN_R} text-slate-600`}>
                                                {formatScenarioCfYoyDiff(borrowSc, actual25)}
                                              </td>
                                              <td
                                                className={`${cfTdNumCore} text-slate-600 ${scKey === 'positive' ? 'border-r-0' : SCENARIO_COL_DIVIDER_BLK_R}`}
                                              >
                                                {plan26 != null
                                                  ? formatScenarioCfVsBase(borrowSc, plan26)
                                                  : '-'}
                                              </td>
                                            </Fragment>
                                          );
                                        }
                                      }
                                      if (scenarioCfRowMirrorsBasePlan(row)) {
                                        return (
                                          <Fragment key={`cf-sc-${row.account}-${scKey}`}>
                                            <td
                                              className={`${cfTdNumCore} ${SCENARIO_COL_DIVIDER_THIN_R} ${plan26 != null && plan26 < 0 ? 'text-red-600' : 'text-slate-700'}`}
                                            >
                                              {plan26 != null ? formatScenarioCfAmount(plan26) : '-'}
                                            </td>
                                            <td className={`${cfTdNumCore} ${SCENARIO_COL_DIVIDER_THIN_R} text-slate-600`}>
                                              {formatScenarioCfYoyDiff(plan26, actual25)}
                                            </td>
                                            <td
                                              className={`${cfTdNumCore} text-slate-600 ${scKey === 'positive' ? 'border-r-0' : SCENARIO_COL_DIVIDER_BLK_R}`}
                                            >
                                              {formatScenarioCfVsBase(plan26, plan26)}
                                            </td>
                                          </Fragment>
                                        );
                                      }
                                      if (
                                        (scKey === 'negative' || scKey === 'positive') &&
                                        row.account === '영업활동' &&
                                        row.level === 0 &&
                                        row.isGroup
                                      ) {
                                        const opSum = cfOperatingActivityScenarioYuan(
                                          scenarioCfRows,
                                          scKey,
                                          scenarioData,
                                        );
                                        if (opSum != null) {
                                          return (
                                            <Fragment key={`cf-sc-${row.account}-${scKey}`}>
                                              <td
                                                className={`${cfTdNumCore} ${SCENARIO_COL_DIVIDER_THIN_R} ${opSum < 0 ? 'text-red-600' : 'text-slate-700'}`}
                                              >
                                                {formatScenarioCfAmount(opSum)}
                                              </td>
                                              <td className={`${cfTdNumCore} ${SCENARIO_COL_DIVIDER_THIN_R} text-slate-600`}>
                                                {formatScenarioCfYoyDiff(opSum, actual25)}
                                              </td>
                                              <td
                                                className={`${cfTdNumCore} text-slate-600 ${scKey === 'positive' ? 'border-r-0' : SCENARIO_COL_DIVIDER_BLK_R}`}
                                              >
                                                {plan26 != null
                                                  ? formatScenarioCfVsBase(opSum, plan26)
                                                  : '-'}
                                              </td>
                                            </Fragment>
                                          );
                                        }
                                      }
                                      if (
                                        (scKey === 'negative' || scKey === 'positive') &&
                                        row.account === 'net cash'
                                      ) {
                                        const ncSum = cfNetCashScenarioYuan(
                                          scenarioCfRows,
                                          scKey,
                                          scenarioData,
                                        );
                                        if (ncSum != null) {
                                          return (
                                            <Fragment key={`cf-sc-${row.account}-${scKey}`}>
                                              <td
                                                className={`${cfTdNumCore} ${SCENARIO_COL_DIVIDER_THIN_R} ${ncSum < 0 ? 'text-red-600' : 'text-slate-700'}`}
                                              >
                                                {formatScenarioCfAmount(ncSum)}
                                              </td>
                                              <td className={`${cfTdNumCore} ${SCENARIO_COL_DIVIDER_THIN_R} text-slate-600`}>
                                                {formatScenarioCfYoyDiff(ncSum, actual25)}
                                              </td>
                                              <td
                                                className={`${cfTdNumCore} text-slate-600 ${scKey === 'positive' ? 'border-r-0' : SCENARIO_COL_DIVIDER_BLK_R}`}
                                              >
                                                {plan26 != null
                                                  ? formatScenarioCfVsBase(ncSum, plan26)
                                                  : '-'}
                                              </td>
                                            </Fragment>
                                          );
                                        }
                                      }
                                      const cfWcAdj =
                                        scKey === 'negative' || scKey === 'positive'
                                          ? cfWcLinkedPlanYuan(row, scKey, plan26, scenarioData)
                                          : null;
                                      if (cfWcAdj != null) {
                                        return (
                                          <Fragment key={`cf-sc-${row.account}-${scKey}`}>
                                            <td
                                              className={`${cfTdNumCore} ${SCENARIO_COL_DIVIDER_THIN_R} ${cfWcAdj < 0 ? 'text-red-600' : 'text-slate-700'}`}
                                            >
                                              {formatScenarioCfAmount(cfWcAdj)}
                                            </td>
                                            <td className={`${cfTdNumCore} ${SCENARIO_COL_DIVIDER_THIN_R} text-slate-600`}>
                                              {formatScenarioCfYoyDiff(cfWcAdj, actual25)}
                                            </td>
                                            <td
                                              className={`${cfTdNumCore} text-slate-600 ${scKey === 'positive' ? 'border-r-0' : SCENARIO_COL_DIVIDER_BLK_R}`}
                                            >
                                              {plan26 != null ? formatScenarioCfVsBase(cfWcAdj, plan26) : '-'}
                                            </td>
                                          </Fragment>
                                        );
                                      }
                                      return (
                                        <Fragment key={`cf-sc-${row.account}-${scKey}`}>
                                          <td className={`${cfTdNumCore} ${SCENARIO_COL_DIVIDER_THIN_R} text-slate-400`}>-</td>
                                          <td className={`${cfTdNumCore} ${SCENARIO_COL_DIVIDER_THIN_R} text-slate-400`}>-</td>
                                          <td
                                            className={`${cfTdNumCore} text-slate-600 ${scKey === 'positive' ? 'border-r-0' : SCENARIO_COL_DIVIDER_BLK_R}`}
                                          >
                                            {formatScenarioCfVsBase(null, plan26)}
                                          </td>
                                        </Fragment>
                                      );
                                    })}
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        <div className="mt-2">
                          <button
                            type="button"
                            onClick={() => setScenarioCfLegendOpen((v) => !v)}
                            className="flex w-full items-center gap-2 rounded-md py-1.5 text-left text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            <span className="inline-flex w-4 shrink-0 justify-center text-[10px] text-slate-500 tabular-nums">
                              {scenarioCfLegendOpen ? '▼' : '▶'}
                            </span>
                            <span>계산로직 (부정 / 기존계획 / 긍정)</span>
                          </button>
                          {scenarioCfLegendOpen && (
                            <div className="mt-2 space-y-2 rounded-none border border-slate-200 bg-slate-50/95 px-3 py-2.5 text-[11px] leading-relaxed text-slate-700">
                              <p className="text-[10px] text-blue-700">
                                ※ 영업활동 중요가정: 매출증감은 매출수금에 직접 반영 | 매출원가 증감은 물품대에 직접 반영 | 직접비·영업비·법인세 증감은 비용에 반영 [법인세율 25%]
                              </p>
                              <p className="text-[10px] text-slate-600">
                                <span className="font-semibold text-slate-800">(1) 매출수금(부정/긍정)</span>{' '}
                                = 기존계획 매출수금 + (부정/긍정) PL 실판매출(V-)의 기존계획대비 증감
                              </p>
                              <p className="text-[10px] text-slate-600">
                                <span className="font-semibold text-slate-800">(2) 물품대(부정/긍정)</span>{' '}
                                = 기존계획 물품대 − (부정/긍정) PL 매출원가의 기존계획대비 증감
                              </p>
                              <p className="text-[10px] text-slate-600">
                                <span className="font-semibold text-slate-800">(3) 비용</span>{' '}
                                기존계획 CF 없음·차액만.{' '}
                                <span className="font-medium text-slate-700">부정/긍정 조정</span> 연간 = −(해당 PL 직접비+영업비 기존계획대비 증감).{' '}
                                <span className="font-medium text-slate-700">법인세 조정</span> 연간 = −(PL 영업이익 기존계획대비 증감 × 법인세율 25%, K 반올림).
                              </p>
                              <p className="border-t border-slate-200 pt-2 text-[10px] text-slate-600">
                                <span className="font-semibold text-slate-800">차입금(부정·긍정)</span>{' '}
                                = 기존계획 차입금 − (△영업활동 + △자산성지출 + △기타수익).{' '}
                                <span className="text-slate-500">※ △: 기존계획대비 증감. 자산성·기타는 기존계획 미러이므로 Δ=0.</span>{' '}
                                <span className="text-blue-600">※ 기말차입금잔액 0 하한: 창출 현금이 잔액 한도를 초과하면 차입금 = 0, 초과분은 기말현금에 반영.</span>
                              </p>
                              <p className="text-[10px] text-slate-600">
                                <span className="font-semibold text-slate-800">net cash</span>{' '}
                                = 영업활동 + 자산성지출 + 기타수익 + 차입금 (4개 항목 합산).
                              </p>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>

                  <div className="mt-6">
                    <table className="w-full border border-slate-200 border-separate border-spacing-0 text-xs">
                      <thead className="sticky top-0 z-20">
                        <tr>
                          <th className="sticky left-0 z-30 min-w-[200px] border-b border-r border-slate-200 bg-gradient-to-r from-[#2f4f7f] to-[#3b5f93] px-3 py-2.5 text-center font-semibold text-white">
                            현금 &amp; 차입금 (법인전체, K단위)
                          </th>
                          <th className="min-w-[88px] border-b border-b-slate-200 border-r border-r-slate-200 bg-slate-700 px-3 py-2.5 text-center font-semibold text-slate-100">
                            기초잔액
                          </th>
                          {SCENARIO_ORDER.map((scKey) => {
                            const def = SCENARIO_DEFS[scKey];
                            const cbHBg = def.headerBgColor ?? def.bgColor;
                            const cbHColor = def.headerColor ?? def.color;
                            const isBase = scKey === 'base';
                            return (
                              <Fragment key={`cbd-hdr-${scKey}`}>
                                <th
                                  className={`min-w-[88px] border-b border-b-slate-200 px-2 py-2.5 text-center font-bold ${SCENARIO_COL_DIVIDER_THIN_R}`}
                                  style={{ background: cbHBg, color: cbHColor }}
                                >
                                  {def.label}
                                </th>
                                <th
                                  className={`min-w-[76px] border-b border-b-slate-200 px-2 py-2.5 text-center font-medium ${!isBase ? SCENARIO_COL_DIVIDER_THIN_R : SCENARIO_COL_DIVIDER_BLK_R}`}
                                  style={{ background: cbHBg, color: cbHColor }}
                                >
                                  전년대비
                                </th>
                                {!isBase && (
                                  <th
                                    className={`min-w-[76px] border-b border-b-slate-200 px-2 py-2.5 text-center font-medium ${scKey === 'positive' ? 'border-r-0' : SCENARIO_COL_DIVIDER_BLK_R}`}
                                    style={{ background: cbHBg, color: cbHColor }}
                                  >
                                    기존계획대비
                                  </th>
                                )}
                              </Fragment>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {(
                          [
                            {
                              label: '현금잔액',
                              openingK: SCENARIO_CASH_DEBT_OPENING_K.cash,
                              planK: scenarioCashBorrowPlanK?.cash ?? null,
                            },
                            {
                              label: '차입금잔액',
                              openingK: SCENARIO_CASH_DEBT_OPENING_K.debt,
                              planK: scenarioCashBorrowPlanK?.debt ?? null,
                            },
                          ] as const
                        ).map((row) => (
                          <tr key={row.label} className="bg-white">
                            <td className="sticky left-0 z-10 border-b border-r border-slate-200 bg-white py-2 pl-[10px] pr-[10px] text-slate-700">
                              {row.label}
                            </td>
                            <td className="border-b border-b-slate-200 border-r border-r-slate-200 px-3 py-2 text-right text-slate-500">
                              {fmtK(row.openingK)}
                            </td>
                            {SCENARIO_ORDER.map((scKey) => {
                              const def = SCENARIO_DEFS[scKey];
                              const isBase = scKey === 'base';
                              const planK = row.planK;
                              const cbdKind = row.label === '현금잔액' ? 'cash' : 'debt';
                              const scenarioVal: number | null = isBase
                                ? planK
                                : scenarioCbdClosingK[scKey]?.[cbdKind] ?? null;
                              return (
                                <Fragment key={`${row.label}-${scKey}`}>
                                  <td
                                    className={`border-b border-b-slate-200 px-3 py-2 text-right font-medium ${SCENARIO_COL_DIVIDER_THIN_R}`}
                                    style={{ color: def.color }}
                                  >
                                    {fmtK(scenarioVal)}
                                  </td>
                                  <td
                                    className={`border-b border-b-slate-200 px-3 py-2 text-right text-slate-500 text-[11px] ${!isBase ? SCENARIO_COL_DIVIDER_THIN_R : SCENARIO_COL_DIVIDER_BLK_R}`}
                                  >
                                    {fmtYoyWc(scenarioVal, row.openingK)}
                                  </td>
                                  {!isBase && (
                                    <td
                                      className={`border-b border-b-slate-200 px-3 py-2 text-right text-slate-500 text-[11px] ${scKey === 'positive' ? 'border-r-0' : SCENARIO_COL_DIVIDER_BLK_R}`}
                                    >
                                      {fmtYoyWc(scenarioVal, planK)}
                                    </td>
                                  )}
                                </Fragment>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="mt-2 space-y-1.5 text-[10px] text-slate-500">
                      <p>
                        csv파일: <span className="font-mono text-[10px]">파일/현금차입금잔액/2026.csv</span> 기말잔액, 페이지 새로고침 하면 즉시 반영
                      </p>
                      <p className="leading-snug">
                        <span className="font-semibold text-slate-600">차입금잔액(부정/긍정)</span>{' '}
                        = 기존계획 차입금잔액 + 현금흐름표 차입금의 기존계획대비 증감.{' '}
                        <span className="text-blue-600">※ 긍정 시나리오 상환 한도 = 기존계획 차입금잔액 (초과 상환분은 현금잔액에 가산)</span>
                        {' | '}
                        <span className="font-semibold text-slate-600">기말현금(부정/긍정)</span>{' '}
                        = 기존계획 기말현금 (통상 변동 없음. 긍정 시나리오에서 차입금 전액 상환 후 잉여 발생 시 해당 금액 반영)
                      </p>
                    </div>
                  </div>
                  </Fragment>
                );
              })()
            : null}
            </div>
          </div>

          {/* 푸터: 내보내기 버튼 */}
          <div className="shrink-0 border-t border-slate-200 bg-white px-6 py-4">
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold text-slate-500">JSON 내보내기:</span>
              {SCENARIO_ORDER.map((scKey) => {
                const def = SCENARIO_DEFS[scKey];
                return (
                  <button
                    key={scKey}
                    type="button"
                    disabled={!scenarioData || scenarioLoading}
                    onClick={() => handleDownloadScenarioJson(scKey)}
                    className="flex items-center gap-1.5 rounded-full border px-4 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                    style={{
                      borderColor: def.borderColor,
                      color: def.color,
                      background: def.bgColor,
                    }}
                  >
                    ↓ {def.label} JSON
                  </button>
                );
              })}
              <span className="ml-auto text-xs text-slate-400">법인 + MLB + MLB KIDS + DISCOVERY 전체 월별 PL 포함</span>
            </div>
          </div>
        </div>
      </div>
    )}
    {/* ──────────────────────────────────────────────────────────────────────── */}
    </div>
  );
}
