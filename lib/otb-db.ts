// ─────────────────────────────────────────────
// 대리상 OTB (Order To Buy) Snowflake 쿼리
// chn.dw_pr + chn.dw_pr_scs 기반
// ─────────────────────────────────────────────

export const OTB_BRANDS = ['MLB', 'MLB KIDS', 'DISCOVERY'] as const;
export type OtbBrand = typeof OTB_BRANDS[number];

export const OTB_SEASONS = ['27F', '27S', '26F', '26S', '25F'] as const;
export type OtbSeason = typeof OTB_SEASONS[number];

export type OtbData = Record<OtbSeason, Record<OtbBrand, number>>;

/** 브랜드 → brd_account_cd 매핑 */
const BRD_ACCOUNT_CD_MAP: Record<OtbBrand, string> = {
  'MLB': 'M',
  'MLB KIDS': 'I',
  'DISCOVERY': 'X',
};

interface OtbQueryRow {
  TOTAL_RETAIL_AMT: number | null;
}

function buildOtbQuery(brdAccountCd: string, sesn: string): string {
  return `
SELECT
  SUM(b.retail_amt) AS TOTAL_RETAIL_AMT
FROM chn.dw_pr a
JOIN chn.dw_pr_scs b
  ON a.pr_no = b.pr_no
WHERE 1=1
  AND a.brd_account_cd = '${brdAccountCd}'
  AND b.sesn = '${sesn}'
  AND a.pr_type_nm_cn = '经销商采购申请 - 期货'
  AND b.parent_prdt_kind_nm_cn = '服装'
`.trim();
}

async function executeSnowflakeQuery<T>(sql: string): Promise<T[]> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const snowflake = require('snowflake-sdk');

  const conn = snowflake.createConnection({
    account: process.env.SNOWFLAKE_ACCOUNT!,
    username: process.env.SNOWFLAKE_USER!,
    password: process.env.SNOWFLAKE_PASSWORD!,
    warehouse: process.env.SNOWFLAKE_WAREHOUSE,
    database: process.env.SNOWFLAKE_DATABASE,
    schema: process.env.SNOWFLAKE_SCHEMA,
    role: process.env.SNOWFLAKE_ROLE,
  });

  return new Promise<T[]>((resolve, reject) => {
    conn.connect((connErr: Error | undefined) => {
      if (connErr) { reject(connErr); return; }
      conn.execute({
        sqlText: sql,
        complete: (execErr: Error | undefined, _stmt: unknown, rows: T[] | undefined) => {
          conn.destroy(() => {});
          if (execErr) { reject(execErr); return; }
          resolve(rows ?? []);
        },
      });
    });
  });
}

/** MLB OTB 하드코딩 값 (CNY 단위, API 호출 없이 고정) */
const MLB_OTB_HARDCODE: Record<OtbSeason, number> = {
  '27F': 0,
  '27S': 250_774_488,
  '26F': 2_478_248_132,
  '26S': 2_313_951_571,
  '25F': 200_000_000,
};

/** MLB KIDS OTB 하드코딩 값 (CNY 단위, API 호출 없이 고정) */
const MLB_KIDS_OTB_HARDCODE: Record<OtbSeason, number> = {
  '27F': 0,
  '27S': 0,
  '26F': 83_957_000,
  '26S': 97_546_000,
  '25F': 0,
};

/** DISCOVERY OTB 하드코딩 값 (CNY 단위, API 호출 없이 고정) */
const DISCOVERY_OTB_HARDCODE: Record<OtbSeason, number> = {
  '27F': 0,
  '27S': 4_989_226,
  '26F': 135_258_137,
  '26S': 76_186_913,
  '25F': 0,
};

/**
 * 2026년 기준 5개 시즌 × 3개 브랜드 OTB 합계(retail_amt)를 병렬 조회.
 * MLB, MLB KIDS, DISCOVERY 브랜드 모두 하드코딩 값 사용.
 * 반환값 단위: CNY (원본) — 호출측에서 ÷1000으로 CNY K 변환.
 */
export async function fetchOtbData(): Promise<OtbData> {
  type Task = { brand: OtbBrand; season: OtbSeason; sql: string };

  const tasks: Task[] = [];
  for (const brand of OTB_BRANDS) {
    if (brand === 'MLB' || brand === 'MLB KIDS' || brand === 'DISCOVERY') continue; // 하드코딩으로 처리
    for (const season of OTB_SEASONS) {
      if (season === '25F') continue; // MLB KIDS의 25F는 조회 제외 (0으로 유지)
      tasks.push({
        brand,
        season,
        sql: buildOtbQuery(BRD_ACCOUNT_CD_MAP[brand], season),
      });
    }
  }

  const results = await Promise.all(
    tasks.map((t) =>
      executeSnowflakeQuery<OtbQueryRow>(t.sql).then((rows) => ({
        brand: t.brand,
        season: t.season,
        value: rows[0]?.TOTAL_RETAIL_AMT ?? 0,
      })),
    ),
  );

  // 빈 구조 초기화
  const data: OtbData = {} as OtbData;
  for (const season of OTB_SEASONS) {
    data[season] = { MLB: 0, 'MLB KIDS': 0, DISCOVERY: 0 };
  }

  for (const { brand, season, value } of results) {
    data[season][brand] = value ?? 0;
  }

  // MLB, MLB KIDS, DISCOVERY는 하드코딩 값으로 덮어쓰기
  for (const season of OTB_SEASONS) {
    data[season]['MLB'] = MLB_OTB_HARDCODE[season];
    data[season]['MLB KIDS'] = MLB_KIDS_OTB_HARDCODE[season];
    data[season]['DISCOVERY'] = DISCOVERY_OTB_HARDCODE[season];
  }

  return data;
}
