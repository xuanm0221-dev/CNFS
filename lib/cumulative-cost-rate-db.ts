// 누적원가율 — Snowflake 쿼리 (sap_fnf.dw_cn_copa_d)
// 사용자 수동 전처리: scripts/refresh_2026_cumulative_cost_rate.py --baseMonth N 호출
import { executeSnowflakeQuery } from './snowflake-client';

export type CumulativeCostBrand = 'MLB' | 'MLB KIDS';

const BRD_CD_MAP: Record<CumulativeCostBrand, string> = {
  MLB: 'M',
  'MLB KIDS': 'I',
};

interface SnowflakeRow {
  // 모든 컬럼은 Snowflake가 대문자로 반환
  '월': string;       // '2025-01' ... '2026-05' 또는 '전체'
  CN_TAG: number | string | null;
  CN원가: number | string | null;
  CN원가율: number | string | null;     // 퍼센트 (15.3)
  IMP_TAG: number | string | null;
  IMP원가: number | string | null;
  IMP원가율: number | string | null;
  CN비중: number | string | null;
  IMP비중: number | string | null;
  가중평균: number | string | null;
}

export interface CumulativeCostRateMonthValues {
  CN원가율: number | null;  // decimal (0.153 = 15.3%)
  IMP원가율: number | null;
  CN비중: number | null;
  가중평균: number | null;
}

export interface CumulativeCostRateBrandResult {
  months: string[];  // '25년1월' ... '26년6월' + '전체'
  rows: {
    CN원가율: (number | null)[];
    IMP원가율: (number | null)[];
    CN비중: (number | null)[];
    가중평균: (number | null)[];
  };
}

export interface CumulativeCostRateQueryResult {
  baseYear: number;
  baseMonth: number;
  brands: Record<CumulativeCostBrand, CumulativeCostRateBrandResult>;
}

function buildQuery(brdCd: string, startDate: string, endDate: string): string {
  return `
WITH base AS (
    SELECT
        TO_CHAR(pst_dt, 'YYYY-MM') AS yymm,
        CASE
            WHEN RIGHT(prdt_cd, 2) = 'CN' THEN 'CN'
            ELSE 'IMP'
        END AS prod_type,
        SUM(tag_sale_amt) AS tag_amt,
        SUM(act_cogs) AS cogs_amt
    FROM sap_fnf.dw_cn_copa_d
    WHERE pst_dt BETWEEN '${startDate}' AND '${endDate}'
      AND brd_cd = '${brdCd}'
    GROUP BY
        TO_CHAR(pst_dt, 'YYYY-MM'),
        CASE WHEN RIGHT(prdt_cd, 2) = 'CN' THEN 'CN' ELSE 'IMP' END
),
summary AS (
    SELECT
        yymm AS "월",
        SUM(CASE WHEN prod_type = 'CN' THEN tag_amt ELSE 0 END) AS cn_tag,
        SUM(CASE WHEN prod_type = 'CN' THEN cogs_amt ELSE 0 END) AS cn_cogs,
        SUM(CASE WHEN prod_type = 'IMP' THEN tag_amt ELSE 0 END) AS imp_tag,
        SUM(CASE WHEN prod_type = 'IMP' THEN cogs_amt ELSE 0 END) AS imp_cogs
    FROM base
    GROUP BY yymm
    UNION ALL
    SELECT
        '전체' AS "월",
        SUM(CASE WHEN prod_type = 'CN' THEN tag_amt ELSE 0 END),
        SUM(CASE WHEN prod_type = 'CN' THEN cogs_amt ELSE 0 END),
        SUM(CASE WHEN prod_type = 'IMP' THEN tag_amt ELSE 0 END),
        SUM(CASE WHEN prod_type = 'IMP' THEN cogs_amt ELSE 0 END)
    FROM base
)
SELECT
    "월",
    ROUND(cn_tag / 1000000, 1) AS "CN_TAG",
    ROUND(cn_cogs / 1000000, 1) AS "CN원가",
    ROUND(cn_cogs * 1.13 / NULLIF(cn_tag, 0) * 100, 1) AS "CN원가율",
    ROUND(imp_tag / 1000000, 1) AS "IMP_TAG",
    ROUND(imp_cogs / 1000000, 1) AS "IMP원가",
    ROUND(imp_cogs * 1.13 / NULLIF(imp_tag, 0) * 100, 1) AS "IMP원가율",
    ROUND(cn_tag / NULLIF(cn_tag + imp_tag, 0) * 100, 1) AS "CN비중",
    ROUND(imp_tag / NULLIF(cn_tag + imp_tag, 0) * 100, 1) AS "IMP비중",
    ROUND((cn_cogs + imp_cogs) * 1.13 / NULLIF(cn_tag + imp_tag, 0) * 100, 1) AS "가중평균"
FROM summary
ORDER BY
    CASE
        WHEN "월" = '전체' THEN 999999
        ELSE TO_NUMBER(REPLACE("월", '-', ''))
    END
`;
}

/** '2025-01' → '25년1월', '전체' → '전체' */
function formatMonth(yymm: string): string {
  if (yymm === '전체') return '전체';
  const m = yymm.match(/^(\d{4})-(\d{2})$/);
  if (!m) return yymm;
  const year = m[1].slice(2);
  const month = parseInt(m[2], 10);
  return `${year}년${month}월`;
}

function toNullableNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** 마지막 날짜 (예: 2026, 5 → '2026-05-31') */
function lastDayOfMonth(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month, 0));
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export async function fetchCumulativeCostRate(
  baseYear: number,
  baseMonth: number,
): Promise<CumulativeCostRateQueryResult> {
  const startDate = '2025-01-01';
  const endDate = lastDayOfMonth(baseYear, baseMonth);

  const result: CumulativeCostRateQueryResult = {
    baseYear,
    baseMonth,
    brands: {
      MLB: { months: [], rows: { CN원가율: [], IMP원가율: [], CN비중: [], 가중평균: [] } },
      'MLB KIDS': { months: [], rows: { CN원가율: [], IMP원가율: [], CN비중: [], 가중평균: [] } },
    },
  };

  for (const brand of ['MLB', 'MLB KIDS'] as CumulativeCostBrand[]) {
    const brdCd = BRD_CD_MAP[brand];
    const sql = buildQuery(brdCd, startDate, endDate);
    const rows = await executeSnowflakeQuery<SnowflakeRow>(sql);

    const bd = result.brands[brand];
    for (const row of rows) {
      const month = String(row['월'] ?? '').trim();
      if (!month) continue;

      bd.months.push(formatMonth(month));

      // 퍼센트 → decimal 변환
      const cn = toNullableNumber(row['CN원가율']);
      const imp = toNullableNumber(row['IMP원가율']);
      const cnShare = toNullableNumber(row['CN비중']);
      const wAvg = toNullableNumber(row['가중평균']);

      bd.rows.CN원가율.push(cn === null ? null : cn / 100);
      bd.rows.IMP원가율.push(imp === null ? null : imp / 100);
      bd.rows.CN비중.push(cnShare === null ? null : cnShare / 100);
      bd.rows.가중평균.push(wAvg === null ? null : wAvg / 100);
    }
  }

  return result;
}
