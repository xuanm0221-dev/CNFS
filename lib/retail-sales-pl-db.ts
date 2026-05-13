// 손익계산서 PL용 리테일매출 — CHN.dw_sale × DW_SHOP_WH_DETAIL × DB_PRDT
// 기존 lib/retail-sales-db.ts(택가 기준, 재고자산 sim용)와 차이점:
//   - 금액 컬럼: tag_amt → sale_amt (실판매액 기준)
//   - 5개 브랜드 동시 조회, 채널(대리상/직영) × 카테고리(의류/ACC) 4-leaf 월별 집계만 반환
import { executeSnowflakeQuery } from './snowflake-client';

export type RetailPLBrandId = 'mlb' | 'kids' | 'discovery' | 'duvetica' | 'supra';
export const RETAIL_PL_BRAND_IDS: RetailPLBrandId[] = ['mlb', 'kids', 'discovery', 'duvetica', 'supra'];

// 브랜드 id → CHN.dw_sale.brd_cd
const BRAND_ID_TO_BRD_CD: Record<RetailPLBrandId, string> = {
  mlb: 'M',
  kids: 'I',
  discovery: 'X',
  duvetica: 'V',
  supra: 'W',
};
const BRD_CD_TO_BRAND_ID: Record<string, RetailPLBrandId> = Object.fromEntries(
  Object.entries(BRAND_ID_TO_BRD_CD).map(([k, v]) => [v, k as RetailPLBrandId]),
) as Record<string, RetailPLBrandId>;

export type RetailPLChannel = '대리상' | '직영';
export type RetailPLCategory = '의류' | 'ACC';

export interface RetailPLBrandData {
  /** 12개월 — value in won (BIGINT). 누락 월 = 0 */
  대리상_의류: number[];
  대리상_ACC: number[];
  직영_의류: number[];
  직영_ACC: number[];
}

export interface RetailPLYearResult {
  year: number;
  brands: Record<RetailPLBrandId, RetailPLBrandData>;
}

function emptyBrandData(): RetailPLBrandData {
  return {
    대리상_의류: new Array(12).fill(0),
    대리상_ACC: new Array(12).fill(0),
    직영_의류: new Array(12).fill(0),
    직영_ACC: new Array(12).fill(0),
  };
}

interface DbRow {
  BRD_CD: string;
  YYMM: string;
  CHANNEL: 'FR' | 'OR';
  CATEGORY: '의류' | 'ACC';
  AMT: number | string;
}

function buildQuery(year: number): string {
  // 직영 매장에 미매핑된 매장도 OR 처리 (기존 retail-sales-db.ts 동일 로직)
  return `
WITH shop_map AS (
  SELECT shop_id, MAX(fr_or_cls) AS fr_or_cls
  FROM CHN.dw_shop_wh_detail
  GROUP BY shop_id
),
sale_base AS (
  SELECT
    s.brd_cd,
    TO_CHAR(s.sale_dt, 'YYYYMM') AS yymm,
    CASE WHEN w.fr_or_cls = 'FR' THEN 'FR' ELSE 'OR' END AS channel,
    SUBSTR(s.prdt_scs_cd, 7, 2) AS item,
    COALESCE(s.sale_amt, 0) AS amt
  FROM CHN.dw_sale s
  LEFT JOIN shop_map w ON s.shop_id = w.shop_id
  WHERE s.sale_dt >= '${year}-01-01'
    AND s.sale_dt < '${year + 1}-01-01'
    AND s.brd_cd IN ('M','I','X','V','W')
),
prdt_dim AS (
  SELECT item, parent_prdt_kind_nm
  FROM (
    SELECT
      ITEM AS item,
      parent_prdt_kind_nm,
      ROW_NUMBER() OVER (PARTITION BY ITEM ORDER BY ITEM) AS rn
    FROM FNF.PRCS.DB_PRDT
    WHERE ITEM IS NOT NULL
  )
  WHERE rn = 1
),
joined AS (
  SELECT
    b.brd_cd,
    b.yymm,
    b.channel,
    b.amt,
    COALESCE(d.parent_prdt_kind_nm, 'UNMAPPED') AS category
  FROM sale_base b
  LEFT JOIN prdt_dim d ON b.item = d.item
)
SELECT
  brd_cd AS BRD_CD,
  yymm AS YYMM,
  channel AS CHANNEL,
  CASE
    WHEN category = '의류' THEN '의류'
    WHEN category = 'ACC'  THEN 'ACC'
    ELSE 'OTHER'
  END AS CATEGORY,
  SUM(amt) AS AMT
FROM joined
GROUP BY 1, 2, 3, 4
HAVING SUM(amt) <> 0
ORDER BY 1, 2
`;
}

/**
 * 연도별 5브랜드 × 4-leaf(대리상/직영 × 의류/ACC) × 12개월 리테일 매출 조회.
 * 카테고리 UNMAPPED는 제외 (의류/ACC 명확 매핑된 항목만 반영).
 */
export async function fetchRetailSalesPLByYear(year: number): Promise<RetailPLYearResult> {
  const sql = buildQuery(year);
  const rows = await executeSnowflakeQuery<DbRow>(sql);

  const brands: Record<RetailPLBrandId, RetailPLBrandData> = {
    mlb: emptyBrandData(),
    kids: emptyBrandData(),
    discovery: emptyBrandData(),
    duvetica: emptyBrandData(),
    supra: emptyBrandData(),
  };

  for (const r of rows) {
    const brandId = BRD_CD_TO_BRAND_ID[r.BRD_CD];
    if (!brandId) continue;
    if (r.CATEGORY !== '의류' && r.CATEGORY !== 'ACC') continue;
    const monthStr = r.YYMM?.slice(4, 6);
    const monthIdx = Number(monthStr) - 1;
    if (!Number.isFinite(monthIdx) || monthIdx < 0 || monthIdx > 11) continue;

    const leafKey: keyof RetailPLBrandData =
      r.CHANNEL === 'FR'
        ? (r.CATEGORY === '의류' ? '대리상_의류' : '대리상_ACC')
        : (r.CATEGORY === '의류' ? '직영_의류' : '직영_ACC');

    const amt = typeof r.AMT === 'string' ? Number(r.AMT) : r.AMT;
    if (!Number.isFinite(amt)) continue;
    brands[brandId][leafKey][monthIdx] += amt;
  }

  return { year, brands };
}
