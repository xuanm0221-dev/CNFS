// 손익계산서 PL용 리테일매출 로더 (서버 전용) — 2025/2026만 지원
//   1~latestActualMonth: Snowflake CHN.dw_sale (의류/ACC 분해 포함)
//   latestActualMonth+1~12: PL(sim)에서 저장한 data/retail-plan.json의 Level 1 값 (대리상/직영 총합)
import { promises as fs } from 'fs';
import path from 'path';
import { BASE_MONTH, BASE_YEAR } from './base-month';
import { aggregateRetailPLAcrossBrands, RetailPLData } from './fs-mapping';
import {
  fetchRetailSalesPLByYear,
  RetailPLBrandId,
  RetailPLYearResult,
} from './retail-sales-pl-db';

declare global {
  // eslint-disable-next-line no-var
  var _retailSalesPLCacheByYear: Record<number, { data: RetailPLYearResult; at: number }> | undefined;
  // eslint-disable-next-line no-var
  var _retailSalesPLInflightByYear: Record<number, Promise<RetailPLYearResult> | undefined> | undefined;
}

const TTL_MS = 12 * 60 * 60 * 1000;

async function getRetailYear(year: number): Promise<RetailPLYearResult | null> {
  if (year !== 2025 && year !== 2026) return null;
  if (!global._retailSalesPLCacheByYear) global._retailSalesPLCacheByYear = {};
  if (!global._retailSalesPLInflightByYear) global._retailSalesPLInflightByYear = {};

  const now = Date.now();
  const cached = global._retailSalesPLCacheByYear[year];
  if (cached && now - cached.at < TTL_MS) return cached.data;

  const existing = global._retailSalesPLInflightByYear[year];
  if (existing) return existing;

  const inflight = fetchRetailSalesPLByYear(year)
    .then((d) => {
      global._retailSalesPLCacheByYear![year] = { data: d, at: Date.now() };
      global._retailSalesPLInflightByYear![year] = undefined;
      return d;
    })
    .catch((err) => {
      global._retailSalesPLInflightByYear![year] = undefined;
      throw err;
    });
  global._retailSalesPLInflightByYear[year] = inflight;
  return inflight;
}

interface SavedRetailPlanBrand {
  dealer: (number | null)[];
  direct: (number | null)[];
}
interface SavedRetailPlanStore {
  year: number;
  savedAt: string;
  brands: Record<string, SavedRetailPlanBrand>;
}

/** PL(sim)에서 저장한 retail-plan.json 읽기. 없거나 연도 불일치 시 null */
async function readSavedRetailPlan(year: number): Promise<SavedRetailPlanStore | null> {
  try {
    const filePath = path.join(process.cwd(), 'data', 'retail-plan.json');
    const buf = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(buf) as SavedRetailPlanStore;
    if (!parsed.brands || parsed.year !== year) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 연도별 결산월(=latestActualMonth) — 부분 실적 데이터 영향 받지 않도록 상수 기반.
 *   BASE_YEAR(=2026): BASE_MONTH(=4)까지 실적, 그 이후 계획
 *   그 외 연도(2025 등): 12 (전체 실적)
 */
function getLatestActualMonth(year: number): number {
  if (year === BASE_YEAR) return BASE_MONTH;
  return 12;
}

/** plan 저장값으로 brand RetailPLData에 대리상_플랜/직영_플랜 + latestActualMonth 채워넣기 */
function attachPlanToBrand(
  brand: RetailPLData,
  saved: SavedRetailPlanStore | null,
  brandName: 'MLB' | 'MLB KIDS' | 'DISCOVERY' | 'DUVETICA' | 'SUPRA',
  year: number,
): RetailPLData {
  const latest = getLatestActualMonth(year);
  const planBrand = saved?.brands[brandName];
  const out: RetailPLData = {
    ...brand,
    latestActualMonth: latest,
    대리상_플랜: new Array(12).fill(null),
    직영_플랜: new Array(12).fill(null),
  };
  if (!planBrand) return out;
  for (let i = 0; i < 12; i += 1) {
    if (i + 1 <= latest) continue; // 실적월 → plan 적용 안함
    out.대리상_플랜![i] = planBrand.dealer?.[i] ?? null;
    out.직영_플랜![i] = planBrand.direct?.[i] ?? null;
  }
  return out;
}

const BRAND_ID_TO_NAME: Record<RetailPLBrandId, 'MLB' | 'MLB KIDS' | 'DISCOVERY' | 'DUVETICA' | 'SUPRA'> = {
  mlb: 'MLB',
  kids: 'MLB KIDS',
  discovery: 'DISCOVERY',
  duvetica: 'DUVETICA',
  supra: 'SUPRA',
};

/** 0으로 채워진 RetailPLData — comparisons 매칭용 fallback */
export function makeEmptyRetailPLData(): RetailPLData {
  return {
    대리상_의류: new Array(12).fill(0),
    대리상_ACC: new Array(12).fill(0),
    직영_의류: new Array(12).fill(0),
    직영_ACC: new Array(12).fill(0),
    대리상_플랜: new Array(12).fill(null),
    직영_플랜: new Array(12).fill(null),
    latestActualMonth: 12, // full year, all leaf
  };
}

/** 특정 브랜드 리테일매출 (2024 등 미지원 연도는 null) */
export async function loadRetailPLByBrand(
  year: number,
  brand: string,
): Promise<RetailPLData | null> {
  try {
    const yr = await getRetailYear(year);
    if (!yr) return null;
    const brandId = brand.toLowerCase() as RetailPLBrandId;
    const data = yr.brands[brandId];
    if (!data) return null;
    const saved = await readSavedRetailPlan(year);
    return attachPlanToBrand(data, saved, BRAND_ID_TO_NAME[brandId], year);
  } catch (err) {
    console.error('[retail-pl-loader] loadRetailPLByBrand error:', err);
    return null;
  }
}

/** 법인 리테일매출 = 5브랜드 합산 (2024 등 미지원 연도는 null) */
export async function loadRetailPLForCorporate(year: number): Promise<RetailPLData | null> {
  try {
    const yr = await getRetailYear(year);
    if (!yr) return null;
    const saved = await readSavedRetailPlan(year);
    // 브랜드별 plan 부착 후 합산
    const augmentedByBrand: Partial<Record<string, RetailPLData>> = {};
    for (const [brandId, data] of Object.entries(yr.brands)) {
      const name = BRAND_ID_TO_NAME[brandId as RetailPLBrandId];
      augmentedByBrand[brandId] = attachPlanToBrand(data, saved, name, year);
    }
    return aggregateRetailPLAcrossBrands(augmentedByBrand);
  } catch (err) {
    console.error('[retail-pl-loader] loadRetailPLForCorporate error:', err);
    return null;
  }
}
