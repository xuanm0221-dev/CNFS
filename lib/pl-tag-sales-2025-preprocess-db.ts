// 2025년 Tag매출 전처리 — Snowflake 직접 쿼리
// PL(sim) 매출 보조지표 하위 섹션용
import { executeSnowflakeQuery } from './snowflake-client';

export type TagSalesBrand = 'MLB' | 'MLB KIDS' | 'DISCOVERY' | 'DUVETICA' | 'SUPRA';
export type TagSalesGrp = '직영' | '대리상(ACC)' | '대리상(의류)';

export interface TagSalesBrandData {
  '직영': Record<string, (number | null)[]>;
  '대리상(ACC)': Record<string, (number | null)[]>;
  '대리상(의류)': Record<string, (number | null)[]>;
}

export interface TagSales2025Result {
  brands: Record<TagSalesBrand, TagSalesBrandData>;
  /** 의류 시즌 태그 전체 (쿼리 결과에서 동적으로 수집, 정렬된 상태) */
  clothingTags: string[];
}

interface SnowflakeRow {
  YYMM: string;
  BRD_CD: string;
  BRAND_NM: string;
  GRP: string;
  TAG: string;
  AMT: number | string | null;
}

const BRAND_NM_MAP: Record<string, TagSalesBrand> = {
  M: 'MLB',
  I: 'MLB KIDS',
  X: 'DISCOVERY',
  V: 'DUVETICA',
  W: 'SUPRA',
};

function emptyBrandData(): TagSalesBrandData {
  return { '직영': {}, '대리상(ACC)': {}, '대리상(의류)': {} };
}

function ensureSeries(bucket: Record<string, (number | null)[]>, tag: string): (number | null)[] {
  if (!bucket[tag]) bucket[tag] = new Array(12).fill(null);
  return bucket[tag];
}

function buildQuery(year: number): string {
  // 5개 브랜드(M/I/X/V/W) 모두 포함, brand_nm 매핑은 애플리케이션에서 brd_cd로 수행
  return `
    WITH base AS (
      SELECT
        TO_CHAR(pst_dt, 'YYYYMM') AS yymm,
        brd_cd,
        CASE WHEN chnl_cd = '84' THEN '대리상' ELSE '직영' END AS chnl_cls,
        CASE
          WHEN SUBSTR(prdt_hrrc_cd2, 1, 1) = 'A' THEN 'ACC'
          WHEN SUBSTR(prdt_hrrc_cd2, 1, 1) = 'L' THEN '의류'
          ELSE '기타'
        END AS item_cls,
        SUBSTR(prdt_cd, 2, 3) AS sesn,
        tag_sale_amt
      FROM sap_fnf.dw_cn_copa_d
      WHERE pst_dt BETWEEN DATE '${year}-01-01' AND DATE '${year}-12-31'
        AND SUBSTR(prdt_hrrc_cd2, 1, 1) IN ('A', 'L')
        AND brd_cd IN ('M', 'I', 'X', 'V', 'W')
    ),
    classified AS (
      SELECT
        yymm,
        brd_cd,
        CASE
          WHEN chnl_cls = '직영' THEN '직영'
          WHEN chnl_cls = '대리상' AND item_cls = 'ACC' THEN '대리상(ACC)'
          WHEN chnl_cls = '대리상' AND item_cls = '의류' THEN '대리상(의류)'
        END AS grp,
        CASE
          WHEN chnl_cls = '직영' THEN '전체'
          WHEN chnl_cls = '대리상' AND item_cls = 'ACC' THEN 'ACC 합계'
          WHEN chnl_cls = '대리상' AND item_cls = '의류' THEN
            CASE WHEN SUBSTR(sesn, 1, 2) <= '22' THEN '과시즌' ELSE sesn END
        END AS tag,
        tag_sale_amt
      FROM base
    )
    SELECT
      yymm AS "YYMM",
      brd_cd AS "BRD_CD",
      brd_cd AS "BRAND_NM",
      grp AS "GRP",
      tag AS "TAG",
      ROUND(SUM(tag_sale_amt) / 1000) AS "AMT"
    FROM classified
    WHERE grp IS NOT NULL AND tag IS NOT NULL
    GROUP BY yymm, brd_cd, grp, tag
    ORDER BY yymm, brd_cd, grp, tag
  `;
}

function sortClothingTags(tags: string[]): string[] {
  // 시즌 코드 정렬: 년도 오름차순, 같은 년도면 S→F, '과시즌'은 맨 앞
  return [...new Set(tags)].sort((a, b) => {
    if (a === '과시즌') return -1;
    if (b === '과시즌') return 1;
    const pa = a.match(/^(\d{2})([SF])$/);
    const pb = b.match(/^(\d{2})([SF])$/);
    if (!pa || !pb) return a.localeCompare(b);
    const yearCmp = pa[1].localeCompare(pb[1]);
    if (yearCmp !== 0) return yearCmp;
    // S가 F보다 먼저 (S=상반기, F=하반기)
    return pa[2] === pb[2] ? 0 : pa[2] === 'S' ? -1 : 1;
  });
}

// 수기 조정 (Snowflake 과대 계상 보정)
// - 2026년 4월 DISCOVERY 1년차(=25S+25F): 시스템 과대 계상으로 -220,836.5K 차감
//   1년차 표시는 25S+25F 합계이므로 25F에 차감 적용해도 합은 동일
type ManualAdjustment = {
  brand: TagSalesBrand;
  grp: TagSalesGrp;
  tag: string;
  monthIdx: number; // 0-based
  deltaK: number;
  note: string;
};
const MANUAL_ADJUSTMENTS_BY_YEAR: Record<number, ManualAdjustment[]> = {
  2026: [
    {
      brand: 'DISCOVERY',
      grp: '대리상(의류)',
      tag: '25F',
      monthIdx: 3, // 4월
      deltaK: -220836.5,
      note: 'DISCOVERY 4월 1년차 시스템 과대 계상 보정',
    },
  ],
};

function applyManualAdjustments(year: number, brands: Record<TagSalesBrand, TagSalesBrandData>): void {
  const adjustments = MANUAL_ADJUSTMENTS_BY_YEAR[year];
  if (!adjustments) return;
  for (const adj of adjustments) {
    const bucket = brands[adj.brand][adj.grp];
    if (!bucket[adj.tag]) bucket[adj.tag] = new Array(12).fill(null);
    const series = bucket[adj.tag];
    const cur = series[adj.monthIdx] ?? 0;
    series[adj.monthIdx] = cur + adj.deltaK;
  }
}

export async function fetchTagSalesByYear(year: number): Promise<TagSales2025Result> {
  const sql = buildQuery(year);
  const rows = await executeSnowflakeQuery<SnowflakeRow>(sql);

  const brands: Record<TagSalesBrand, TagSalesBrandData> = {
    MLB: emptyBrandData(),
    'MLB KIDS': emptyBrandData(),
    DISCOVERY: emptyBrandData(),
    DUVETICA: emptyBrandData(),
    SUPRA: emptyBrandData(),
  };

  const clothingTagSet = new Set<string>();

  for (const row of rows) {
    const brd = BRAND_NM_MAP[String(row.BRD_CD).trim()];
    if (!brd) continue;
    const grp = row.GRP as TagSalesGrp;
    if (grp !== '직영' && grp !== '대리상(ACC)' && grp !== '대리상(의류)') continue;
    const tag = String(row.TAG).trim();
    const yymm = String(row.YYMM).trim();
    const monthIdx = Number(yymm.slice(4, 6)) - 1;
    if (!Number.isInteger(monthIdx) || monthIdx < 0 || monthIdx > 11) continue;

    const amtRaw = row.AMT;
    const amt = amtRaw === null || amtRaw === undefined ? null : Number(amtRaw);
    if (amt !== null && !Number.isFinite(amt)) continue;

    const series = ensureSeries(brands[brd][grp], tag);
    series[monthIdx] = (series[monthIdx] ?? 0) + (amt ?? 0);

    if (grp === '대리상(의류)') clothingTagSet.add(tag);
  }

  // 수기 조정 적용 (시스템 과대 계상 등)
  applyManualAdjustments(year, brands);
  // 조정으로 새 tag 키가 추가됐을 수 있으므로 clothingTagSet 재구성
  for (const brand of Object.keys(brands) as TagSalesBrand[]) {
    for (const tag of Object.keys(brands[brand]['대리상(의류)'])) {
      clothingTagSet.add(tag);
    }
  }

  return {
    brands,
    clothingTags: sortClothingTags([...clothingTagSet]),
  };
}
