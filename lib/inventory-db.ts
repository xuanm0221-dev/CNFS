import {
  MonthlySeasonKey,
  MonthlyAccKey,
  MonthlyStockRow,
  MonthlyStockTableData,
  DbClothingRow,
  DbAccRow,
} from './inventory-monthly-types';
import { executeSnowflakeQuery } from './snowflake-client';

// ─────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────

/** 현재 마감된 최신 YYMM (이 값 이하만 DB에서 조회) */
export const CLOSED_THROUGH = '202603';

const SEASON_KEYS: MonthlySeasonKey[] = ['당년F', '당년S', '1년차', '2년차', '차기시즌', '과시즌'];
const ACC_KEYS: MonthlyAccKey[] = ['신발', '모자', '가방', '기타'];

const LABELS: Record<string, string> = {
  '당년F': '당년F', '당년S': '당년S',
  '1년차': '1년차', '2년차': '2년차', '차기시즌': '차기시즌', '과시즌': '과시즌',
  '신발': '신발', '모자': '모자', '가방': '가방', '기타': '기타',
  '의류합계': '의류합계', 'ACC합계': 'ACC합계', '재고자산합계': '재고자산합계',
};

/** 브랜드 → brd_cd 매핑 (undefined = 필터 없음 = 전체) */
export const BRD_CD_MAP: Record<string, string | undefined> = {
  'MLB': 'M',
  'MLB KIDS': 'I', // TODO: brd_cd 확정 후 입력
  'DISCOVERY': 'X', // TODO: brd_cd 확정 후 입력
  '전체': undefined,
};

// ─────────────────────────────────────────────
// 매핑 함수
// ─────────────────────────────────────────────

/**
 * DB sesn 값 (예: 'F25', 'S25') → SeasonKey 변환
 * displayYear 기준 상대 레이블 반환. 해당 없으면 null.
 */
export function normalizeSeasonKey(
  sesn: string,
  displayYear: number,
): MonthlySeasonKey | null {
  if (sesn.includes('X')) return null;

  const match = sesn.match(/^(\d{2})([FS])$/);
  if (!match) return '과시즌';

  const sesnYY = parseInt(match[1], 10);
  const type = match[2] as 'F' | 'S';
  const yy = displayYear % 100;

  if (type === 'F' && sesnYY === yy) return '당년F';
  if (type === 'S' && sesnYY === yy) return '당년S';
  if (sesnYY === (yy - 1 + 100) % 100) return '1년차';
  if (sesnYY === (yy - 2 + 100) % 100) return '2년차';
  if (sesnYY === (yy + 1) % 100) return '차기시즌';
  return '과시즌';
}

/** DB prdt_kind_nm → AccKey 변환 */
export function accCategoryToKey(cat: string): MonthlyAccKey | null {
  const map: Record<string, MonthlyAccKey> = {
    Shoes: '신발',
    Headwear: '모자',
    Bag: '가방',
    Acc_etc: '기타',
  };
  return map[cat] ?? null;
}

// ─────────────────────────────────────────────
// SQL 빌더
// ─────────────────────────────────────────────

function yymmInClause(yymmList: string[]): string {
  return yymmList.map((y) => `'${y}'`).join(', ');
}

function brdCdFilter(brdCd: string | undefined): string {
  return brdCd ? `AND s.brd_cd = '${brdCd}'` : '';
}

/** FR(대리상) 의류 쿼리 — YYMM IN, GROUP BY YYMM */
export function buildFrClothingQuery(
  yymmList: string[],
  brdCd: string | undefined,
): string {
  return `
WITH stock_base AS (
  SELECT
    s.YYMM,
    s.sesn,
    SUBSTR(s.prdt_scs_cd, 7, 2) AS item,
    COALESCE(s.stock_tag_amt_insp, 0)
      + COALESCE(s.stock_tag_amt_frozen, 0)
      + COALESCE(s.stock_tag_amt_expected, 0) AS stock_amt
  FROM CHN.dw_stock_m s
  JOIN CHN.dw_shop_wh_detail w
    ON s.shop_id = w.shop_id
  WHERE s.YYMM IN (${yymmInClause(yymmList)})
    ${brdCdFilter(brdCd)}
    AND w.fr_or_cls = 'FR'
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
    b.YYMM,
    b.sesn,
    b.stock_amt,
    COALESCE(d.parent_prdt_kind_nm, 'UNMAPPED') AS parent_prdt_kind_nm
  FROM stock_base b
  LEFT JOIN prdt_dim d ON b.item = d.item
)
SELECT
  YYMM,
  sesn AS season,
  SUM(stock_amt) AS stock_amt_sum
FROM joined
WHERE parent_prdt_kind_nm IN ('의류', 'UNMAPPED')
GROUP BY 1, 2
ORDER BY 1, 2
`;
}

/** FR(대리상) ACC 쿼리 — YYMM IN, GROUP BY YYMM */
export function buildFrAccQuery(
  yymmList: string[],
  brdCd: string | undefined,
): string {
  return `
WITH stock_base AS (
  SELECT
    s.YYMM,
    s.sesn,
    SUBSTR(s.prdt_scs_cd, 7, 2) AS item,
    COALESCE(s.stock_tag_amt_insp, 0)
      + COALESCE(s.stock_tag_amt_frozen, 0)
      + COALESCE(s.stock_tag_amt_expected, 0) AS stock_amt
  FROM CHN.dw_stock_m s
  JOIN CHN.dw_shop_wh_detail w
    ON s.shop_id = w.shop_id
  WHERE s.YYMM IN (${yymmInClause(yymmList)})
    ${brdCdFilter(brdCd)}
    AND w.fr_or_cls = 'FR'
),
prdt_dim AS (
  SELECT item, parent_prdt_kind_nm, prdt_kind_nm
  FROM (
    SELECT
      ITEM AS item,
      parent_prdt_kind_nm,
      prdt_kind_nm,
      ROW_NUMBER() OVER (PARTITION BY ITEM ORDER BY ITEM) AS rn
    FROM FNF.PRCS.DB_PRDT
    WHERE ITEM IS NOT NULL
  )
  WHERE rn = 1
),
joined AS (
  SELECT
    b.YYMM,
    b.sesn,
    b.stock_amt,
    COALESCE(d.parent_prdt_kind_nm, 'UNMAPPED') AS parent_prdt_kind_nm,
    d.prdt_kind_nm
  FROM stock_base b
  LEFT JOIN prdt_dim d ON b.item = d.item
)
SELECT
  YYMM,
  CASE
    WHEN parent_prdt_kind_nm = 'ACC'     THEN prdt_kind_nm
    WHEN parent_prdt_kind_nm = 'UNMAPPED' THEN sesn
    ELSE 'OTHER'
  END AS acc_mid_category,
  SUM(stock_amt) AS stock_amt_sum
FROM joined
WHERE parent_prdt_kind_nm IN ('ACC', 'UNMAPPED')
GROUP BY 1, 2
ORDER BY 1, 2
`;
}

/** OR(직영) 의류 쿼리 — shop_map CTE 방식 */
export function buildOrClothingQuery(
  yymmList: string[],
  brdCd: string | undefined,
): string {
  return `
WITH shop_map AS (
  SELECT shop_id, fr_or_cls
  FROM (
    SELECT
      shop_id,
      fr_or_cls,
      ROW_NUMBER() OVER (PARTITION BY shop_id ORDER BY shop_id) AS rn
    FROM CHN.dw_shop_wh_detail
  )
  WHERE rn = 1
),
stock_base AS (
  SELECT
    s.YYMM,
    s.sesn,
    SUBSTR(s.prdt_scs_cd, 7, 2) AS item,
    COALESCE(s.stock_tag_amt_insp, 0)
      + COALESCE(s.stock_tag_amt_frozen, 0)
      + COALESCE(s.stock_tag_amt_expected, 0) AS stock_amt
  FROM CHN.dw_stock_m s
  JOIN shop_map w ON s.shop_id = w.shop_id
  WHERE s.YYMM IN (${yymmInClause(yymmList)})
    ${brdCdFilter(brdCd)}
    AND w.fr_or_cls = 'OR'
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
    b.YYMM,
    b.sesn,
    b.stock_amt,
    COALESCE(d.parent_prdt_kind_nm, 'UNMAPPED') AS parent_prdt_kind_nm
  FROM stock_base b
  LEFT JOIN prdt_dim d ON b.item = d.item
)
SELECT
  YYMM,
  sesn AS season,
  SUM(stock_amt) AS stock_amt_sum
FROM joined
WHERE parent_prdt_kind_nm IN ('의류', 'UNMAPPED')
GROUP BY 1, 2
ORDER BY 1, 2
`;
}

/** OR(직영) ACC 쿼리 — shop_map CTE 방식 */
export function buildOrAccQuery(
  yymmList: string[],
  brdCd: string | undefined,
): string {
  return `
WITH shop_map AS (
  SELECT shop_id, fr_or_cls
  FROM (
    SELECT
      shop_id,
      fr_or_cls,
      ROW_NUMBER() OVER (PARTITION BY shop_id ORDER BY shop_id) AS rn
    FROM CHN.dw_shop_wh_detail
  )
  WHERE rn = 1
),
stock_base AS (
  SELECT
    s.YYMM,
    s.sesn,
    SUBSTR(s.prdt_scs_cd, 7, 2) AS item,
    COALESCE(s.stock_tag_amt_insp, 0)
      + COALESCE(s.stock_tag_amt_frozen, 0)
      + COALESCE(s.stock_tag_amt_expected, 0) AS stock_amt
  FROM CHN.dw_stock_m s
  JOIN shop_map w ON s.shop_id = w.shop_id
  WHERE s.YYMM IN (${yymmInClause(yymmList)})
    ${brdCdFilter(brdCd)}
    AND w.fr_or_cls = 'OR'
),
prdt_dim AS (
  SELECT item, parent_prdt_kind_nm, prdt_kind_nm
  FROM (
    SELECT
      ITEM AS item,
      parent_prdt_kind_nm,
      prdt_kind_nm,
      ROW_NUMBER() OVER (PARTITION BY ITEM ORDER BY ITEM) AS rn
    FROM FNF.PRCS.DB_PRDT
    WHERE ITEM IS NOT NULL
  )
  WHERE rn = 1
),
joined AS (
  SELECT
    b.YYMM,
    b.sesn,
    b.stock_amt,
    COALESCE(d.parent_prdt_kind_nm, 'UNMAPPED') AS parent_prdt_kind_nm,
    d.prdt_kind_nm
  FROM stock_base b
  LEFT JOIN prdt_dim d ON b.item = d.item
)
SELECT
  YYMM,
  CASE
    WHEN parent_prdt_kind_nm = 'ACC'     THEN prdt_kind_nm
    WHEN parent_prdt_kind_nm = 'UNMAPPED' THEN sesn
    ELSE 'OTHER'
  END AS acc_mid_category,
  SUM(stock_amt) AS stock_amt_sum
FROM joined
WHERE parent_prdt_kind_nm IN ('ACC', 'UNMAPPED')
GROUP BY 1, 2
ORDER BY 1, 2
`;
}

// ─────────────────────────────────────────────
// 데이터 변환
// ─────────────────────────────────────────────

function addToCell(
  map: Map<string, Map<string, number>>,
  key: string,
  yymm: string,
  value: number,
) {
  if (!map.has(key)) map.set(key, new Map());
  const byYymm = map.get(key)!;
  byYymm.set(yymm, (byYymm.get(yymm) ?? 0) + value);
}

/**
 * DB 조회 결과 + YYMM 리스트 → MonthlyStockTableData
 * yymmList[0] = 기초(전년 12월), yymmList[1..12] = 1월~12월
 */
function buildMonthlyStockTable(
  clothingRows: DbClothingRow[],
  accRows: DbAccRow[],
  yymmList: string[],
  displayYear: number,
): MonthlyStockTableData {
  const openingYymm = yymmList[0];
  const monthYymms = yymmList.slice(1); // 1월~12월

  // key → yymm → 합산금액
  const dataMap = new Map<string, Map<string, number>>();

  for (const row of clothingRows) {
    const key = normalizeSeasonKey(row.SEASON, displayYear);
    if (!key) continue;
    addToCell(dataMap, key, row.YYMM, row.STOCK_AMT_SUM);
  }
  for (const row of accRows) {
    const key = accCategoryToKey(row.ACC_MID_CATEGORY);
    if (!key) continue;
    addToCell(dataMap, key, row.YYMM, row.STOCK_AMT_SUM);
  }

  function getValue(key: string, yymm: string): number | null {
    return dataMap.get(key)?.get(yymm) ?? null;
  }

  function buildLeaf(key: MonthlySeasonKey | MonthlyAccKey): MonthlyStockRow {
    return {
      key,
      label: LABELS[key] ?? key,
      isTotal: false,
      isSubtotal: false,
      isLeaf: true,
      opening: getValue(key, openingYymm),
      monthly: monthYymms.map((yymm) => getValue(key, yymm)),
    };
  }

  function buildSubtotal(key: string, children: MonthlyStockRow[]): MonthlyStockRow {
    function sumCol(col: (number | null)[]): number | null {
      const valid = col.filter((v): v is number => v !== null);
      return valid.length > 0 ? valid.reduce((a, b) => a + b, 0) : null;
    }
    return {
      key,
      label: LABELS[key] ?? key,
      isTotal: key === '재고자산합계',
      isSubtotal: key !== '재고자산합계',
      isLeaf: false,
      opening: sumCol(children.map((r) => r.opening)),
      monthly: Array.from({ length: 12 }, (_, i) =>
        sumCol(children.map((r) => r.monthly[i]))
      ),
    };
  }

  const clothingLeafs = SEASON_KEYS.map(buildLeaf);
  const accLeafs = ACC_KEYS.map(buildLeaf);
  const clothingSubtotal = buildSubtotal('의류합계', clothingLeafs);
  const accSubtotal = buildSubtotal('ACC합계', accLeafs);
  const grandTotal = buildSubtotal('재고자산합계', [clothingSubtotal, accSubtotal]);

  return {
    rows: [
      grandTotal,
      clothingSubtotal,
      ...clothingLeafs,
      accSubtotal,
      ...accLeafs,
    ],
  };
}

// ─────────────────────────────────────────────
// 공개 API
// ─────────────────────────────────────────────

export interface MonthlyStockResult {
  dealer: MonthlyStockTableData;
  hq: MonthlyStockTableData;
}

/**
 * 4개 쿼리 실행 후 대리상(FR) / 직영(OR) 월별 재고잔액 반환
 * @param yymmList [기초YYMM, 1월YYMM, ..., 12월YYMM] — CLOSED_THROUGH 필터 적용 후 값
 * @param brand    브랜드 (BRD_CD_MAP 키)
 * @param displayYear 연도 탭 (시즌 레이블 계산 기준)
 */
export async function fetchMonthlyStock(
  yymmList: string[],
  brand: string,
  displayYear: number,
): Promise<MonthlyStockResult> {
  const brdCd = BRD_CD_MAP[brand];

  const [frClothing, frAcc, orClothing, orAcc] = await Promise.all([
    executeSnowflakeQuery<DbClothingRow>(buildFrClothingQuery(yymmList, brdCd)),
    executeSnowflakeQuery<DbAccRow>(buildFrAccQuery(yymmList, brdCd)),
    executeSnowflakeQuery<DbClothingRow>(buildOrClothingQuery(yymmList, brdCd)),
    executeSnowflakeQuery<DbAccRow>(buildOrAccQuery(yymmList, brdCd)),
  ]);

  return {
    dealer: buildMonthlyStockTable(frClothing, frAcc, yymmList, displayYear),
    hq: buildMonthlyStockTable(orClothing, orAcc, yymmList, displayYear),
  };
}
