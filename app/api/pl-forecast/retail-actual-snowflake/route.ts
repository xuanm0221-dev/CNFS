// PL(sim) 리테일매출 actual — Snowflake CHN.dw_sale 의 sale_amt (실판매가, post-discount)
// 1~BASE_MONTH 실적월만 반환. 24시간 in-memory 캐시.
// ?refresh=1 강제 갱신.
import { NextRequest, NextResponse } from 'next/server';
import { executeSnowflakeQuery } from '@/lib/snowflake-client';
import { BASE_YEAR, BASE_MONTH } from '@/lib/base-month';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RetailBrand = 'MLB' | 'MLB KIDS' | 'DISCOVERY' | 'DUVETICA' | 'SUPRA';

const BRD_CD_MAP: Record<RetailBrand, string | null> = {
  MLB: 'M',
  'MLB KIDS': 'I',
  DISCOVERY: 'X',
  DUVETICA: null, // Snowflake 데이터 미지원
  SUPRA: null,
};

interface RetailActualBrandData {
  dealer: (number | null)[]; // FR 채널 (대리상) 월별 SUM(sale_amt)
  direct: (number | null)[]; // OR 채널 (직영) 월별 SUM(sale_amt)
}

interface RetailActualResponse {
  year: number;
  baseMonth: number;
  cachedAt: number;
  source: string;
  brands: Record<RetailBrand, RetailActualBrandData>;
}

declare global {
  // eslint-disable-next-line no-var
  var _plRetailActualCache: { data: RetailActualResponse; at: number } | undefined;
  // eslint-disable-next-line no-var
  var _plRetailActualInflight: Promise<RetailActualResponse> | undefined;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function emptyBrandData(): RetailActualBrandData {
  return { dealer: new Array(12).fill(null), direct: new Array(12).fill(null) };
}

interface SnowflakeRow {
  YYMM: string;
  TOTAL: number | string | null;
}

/** FR(대리상) 실판매출 — sale_amt 사용. INNER JOIN 으로 매장 매핑 'FR' 만 */
function buildFrSql(brdCd: string, startDate: string, endDate: string): string {
  return `
    SELECT
      TO_CHAR(s.sale_dt, 'YYYYMM') AS YYMM,
      SUM(s.sale_amt) AS TOTAL
    FROM CHN.dw_sale s
    JOIN CHN.dw_shop_wh_detail w ON s.shop_id = w.shop_id
    WHERE s.sale_dt >= '${startDate}'
      AND s.sale_dt <  '${endDate}'
      AND s.brd_cd = '${brdCd}'
      AND w.fr_or_cls = 'FR'
    GROUP BY 1
    ORDER BY 1
  `;
}

/** OR(직영) 실판매출 — sale_amt 사용. shop_map CTE 로 NULL 매핑 매장도 OR 로 포함 */
function buildOrSql(brdCd: string, startDate: string, endDate: string): string {
  return `
    WITH shop_map AS (
      SELECT shop_id, MAX(fr_or_cls) AS fr_or_cls
      FROM CHN.dw_shop_wh_detail
      GROUP BY shop_id
    )
    SELECT
      TO_CHAR(s.sale_dt, 'YYYYMM') AS YYMM,
      SUM(s.sale_amt) AS TOTAL
    FROM CHN.dw_sale s
    LEFT JOIN shop_map w ON s.shop_id = w.shop_id
    WHERE s.sale_dt >= '${startDate}'
      AND s.sale_dt <  '${endDate}'
      AND s.brd_cd = '${brdCd}'
      AND (w.fr_or_cls = 'OR' OR w.fr_or_cls IS NULL)
    GROUP BY 1
    ORDER BY 1
  `;
}

function lastDayOfMonth(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

async function fetchBrandMonthly(brand: RetailBrand, year: number, baseMonth: number): Promise<RetailActualBrandData> {
  const brdCd = BRD_CD_MAP[brand];
  if (!brdCd) return emptyBrandData();

  const startDate = `${year}-01-01`;
  const endDate = lastDayOfMonth(year, baseMonth); // baseMonth+1 의 1일

  try {
    const [frRows, orRows] = await Promise.all([
      executeSnowflakeQuery<SnowflakeRow>(buildFrSql(brdCd, startDate, endDate)),
      executeSnowflakeQuery<SnowflakeRow>(buildOrSql(brdCd, startDate, endDate)),
    ]);

    const dealer: (number | null)[] = new Array(12).fill(null);
    const direct: (number | null)[] = new Array(12).fill(null);

    for (const r of frRows) {
      const yymm = String(r.YYMM ?? '');
      const m = Number(yymm.slice(4, 6));
      if (!Number.isInteger(m) || m < 1 || m > 12) continue;
      const v = r.TOTAL == null ? null : Number(r.TOTAL);
      if (v == null || !Number.isFinite(v)) continue;
      dealer[m - 1] = v;
    }
    for (const r of orRows) {
      const yymm = String(r.YYMM ?? '');
      const m = Number(yymm.slice(4, 6));
      if (!Number.isInteger(m) || m < 1 || m > 12) continue;
      const v = r.TOTAL == null ? null : Number(r.TOTAL);
      if (v == null || !Number.isFinite(v)) continue;
      direct[m - 1] = v;
    }

    // baseMonth 초과 월 강제 null (안전망)
    for (let i = baseMonth; i < 12; i += 1) {
      dealer[i] = null;
      direct[i] = null;
    }

    return { dealer, direct };
  } catch {
    return emptyBrandData();
  }
}

async function loadAll(year: number, baseMonth: number): Promise<RetailActualResponse> {
  const brandsData: Record<RetailBrand, RetailActualBrandData> = {
    MLB: emptyBrandData(),
    'MLB KIDS': emptyBrandData(),
    DISCOVERY: emptyBrandData(),
    DUVETICA: emptyBrandData(),
    SUPRA: emptyBrandData(),
  };

  const results = await Promise.all(
    (Object.keys(BRD_CD_MAP) as RetailBrand[]).map(async (brand) => ({
      brand,
      data: await fetchBrandMonthly(brand, year, baseMonth),
    })),
  );

  for (const { brand, data } of results) {
    brandsData[brand] = data;
  }

  return {
    year,
    baseMonth,
    cachedAt: Date.now(),
    source: 'CHN.dw_sale.sale_amt (FR/OR, 1~baseMonth)',
    brands: brandsData,
  };
}

export async function GET(req: NextRequest) {
  try {
    const yearRaw = req.nextUrl.searchParams.get('year') ?? String(BASE_YEAR);
    const year = Number(yearRaw);
    if (!Number.isInteger(year) || year < 2020 || year > 2100) {
      return NextResponse.json({ error: 'year 가 유효하지 않습니다.' }, { status: 400 });
    }
    const force = req.nextUrl.searchParams.get('refresh') === '1';
    const baseMonth = year === BASE_YEAR ? BASE_MONTH : 12;
    const now = Date.now();

    const cached = global._plRetailActualCache;
    if (!force && cached && cached.data.year === year && cached.data.baseMonth === baseMonth && now - cached.at < CACHE_TTL_MS) {
      return NextResponse.json(cached.data, { headers: { 'Cache-Control': 'no-store' } });
    }

    const existing = global._plRetailActualInflight;
    if (!force && existing) {
      const data = await existing;
      return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
    }

    const inflight = loadAll(year, baseMonth)
      .then((data) => {
        global._plRetailActualCache = { data, at: Date.now() };
        global._plRetailActualInflight = undefined;
        return data;
      })
      .catch((err) => {
        global._plRetailActualInflight = undefined;
        throw err;
      });
    global._plRetailActualInflight = inflight;
    const data = await inflight;

    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `PL 리테일 actual Snowflake 조회 오류: ${message}` }, { status: 500 });
  }
}
