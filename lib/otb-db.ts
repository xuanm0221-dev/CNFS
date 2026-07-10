// ─────────────────────────────────────────────
// 대리상 OTB (Order To Buy) Snowflake 쿼리
// chn.dw_pr + chn.dw_pr_scs 기반
// ─────────────────────────────────────────────
import { executeSnowflakeQuery } from './snowflake-client';

export const OTB_BRANDS = ['MLB', 'MLB KIDS', 'DISCOVERY'] as const;
export type OtbBrand = typeof OTB_BRANDS[number];

export const OTB_SEASONS = ['27F', '27S', '26F', '26S', '25F'] as const;
export type OtbSeason = typeof OTB_SEASONS[number];

export type OtbData = Record<OtbSeason, Record<OtbBrand, number>>;

/** 셀별 값 출처: SF=Snowflake 라이브 발주, HC=하드코딩 목표 */
export type OtbSource = 'SF' | 'HC';
export type OtbSourceMap = Record<OtbSeason, Record<OtbBrand, OtbSource>>;

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

/** MLB OTB 하드코딩 값 = 목표/계획 (CNY 단위). 계획 변경 시 이 값을 직접 수정. */
const MLB_OTB_HARDCODE: Record<OtbSeason, number> = {
  '27F': 0,
  '27S': 250_774_000,
  '26F': 2_705_402_000, // 목표 (Snowflake 실제가 이걸 넘으면 실제 사용)
  '26S': 2_316_846_000, // 목표
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
 * 2026년 기준 5개 시즌 × 3개 브랜드 OTB 합계(retail_amt) 조회.
 * 정책:
 *   - MLB / MLB KIDS 의 26S, 26F: Snowflake 라이브 조회
 *   - 그 외 (DISCOVERY 전체, MLB/KIDS 의 27F/27S/25F): 하드코딩 유지
 * 반환값 단위: CNY (원본) — 호출측에서 ÷1000으로 CNY K 변환.
 */
const SNOWFLAKE_QUERY_PAIRS: Array<{ brand: OtbBrand; season: OtbSeason }> = [
  { brand: 'MLB', season: '26S' },
  { brand: 'MLB', season: '26F' },
  { brand: 'MLB', season: '27S' },
  { brand: 'MLB', season: '27F' },
  { brand: 'MLB KIDS', season: '26S' },
  { brand: 'MLB KIDS', season: '26F' },
  { brand: 'MLB KIDS', season: '27S' },
  { brand: 'MLB KIDS', season: '27F' },
  { brand: 'DISCOVERY', season: '26S' },
  { brand: 'DISCOVERY', season: '26F' },
  { brand: 'DISCOVERY', season: '27S' },
  { brand: 'DISCOVERY', season: '27F' },
];

export async function fetchOtbData(): Promise<{ data: OtbData; source: OtbSourceMap }> {
  // 빈 구조 초기화 후 하드코딩 베이스 깔기 (source 는 전부 HC 로 시작)
  const data: OtbData = {} as OtbData;
  const source: OtbSourceMap = {} as OtbSourceMap;
  for (const season of OTB_SEASONS) {
    data[season] = {
      MLB: MLB_OTB_HARDCODE[season],
      'MLB KIDS': MLB_KIDS_OTB_HARDCODE[season],
      DISCOVERY: DISCOVERY_OTB_HARDCODE[season],
    };
    source[season] = { MLB: 'HC', 'MLB KIDS': 'HC', DISCOVERY: 'HC' };
  }

  // Snowflake 조회 대상만 조회 후 비교
  //   - Snowflake > 하드코딩 → Snowflake 채택(SF) (발주 추가됨)
  //   - Snowflake ≤ 하드코딩 → 하드코딩 유지(HC) (안전한 최대값)
  const results = await Promise.all(
    SNOWFLAKE_QUERY_PAIRS.map(({ brand, season }) =>
      executeSnowflakeQuery<OtbQueryRow>(buildOtbQuery(BRD_ACCOUNT_CD_MAP[brand], season))
        .then((rows) => ({ brand, season, value: rows[0]?.TOTAL_RETAIL_AMT ?? null }))
        .catch(() => ({ brand, season, value: null })),
    ),
  );
  for (const { brand, season, value } of results) {
    if (value == null || !Number.isFinite(Number(value))) continue;
    const sfVal = Number(value);
    const hcVal = data[season][brand]; // 위에서 하드코딩으로 초기화된 베이스 값
    if (sfVal > hcVal) {
      data[season][brand] = sfVal; // SF 가 더 크면 채택
      source[season][brand] = 'SF';
    }
  }

  return { data, source };
}
