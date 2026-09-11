// 시나리오(긍정·부정) — 지난달 보고 대비 모달의 시나리오 표가 쓰는 원시 데이터
//
// 계산은 클라이언트(lib/pl-scenario.ts)가 한다. ±% 입력을 바꿀 때마다 서버를 다시 부르지
// 않으려고, 여기서는 브랜드별 2026 계획과 2025 실적의 원시 계정 시리즈만 준다.
//   법인(all) 이면 5개 브랜드를 전부 주고 클라이언트가 브랜드별로 계산해 합산한다.
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { readCSV } from '@/lib/csv';
import {
  createMonthDataMap, getAccountValues, CORPORATE_PL_BRAND_IDS,
  DIRECT_EXPENSE_ITEMS, OPEX_ITEMS,
} from '@/lib/fs-mapping';
import { BASE_MONTH } from '@/lib/base-month';
import { loadIFRSAdjust } from '@/lib/ifrs-adjust-loader';
import { loadRetailPLByBrand } from '@/lib/retail-pl-loader';
import type { RetailPLData } from '@/lib/fs-mapping';
import type { DetailAdjustSection } from '@/lib/csv';

export const dynamic = 'force-dynamic';

const VALID_BRANDS = ['mlb', 'kids', 'discovery', 'duvetica', 'supra'];

/** 시나리오 계산에 필요한 계정 전부 — 이 목록 밖의 계정은 내보내지 않는다 */
const ACCOUNTS: readonly string[] = [
  'Tag매출',
  'Tag매출_직영(ON)', 'Tag매출_직영(OFF)', 'Tag매출_대리상(ON)', 'Tag매출_대리상(OFF)',
  'Tag매출_대리상_APP', 'Tag매출_대리상_ACC',
  '실판매출',
  '실판매출_직영(ON)', '실판매출_직영(OFF)', '실판매출_대리상(ON)', '실판매출_대리상(OFF)',
  '매출원가', '평가감(설정)', '평가감(환입)',
  ...DIRECT_EXPENSE_ITEMS,
  ...OPEX_ITEMS,
];

/** (IFRS) 블록에 쓰는 재무조정 — 시나리오와 무관하게 고정 */
export interface ScenarioIFRS {
  /** 섹션별 조정 합계 12개월 (元) */
  total: Record<DetailAdjustSection, number[]>;
  /** Discovery 반품 순효과 12개월 (元) */
  intercompany: number[];
}

export interface ScenarioBrandData {
  /** 계정 → 12개월 (元). 2026 은 1~BASE_MONTH 실적 + 이후 계획 */
  current: Record<string, number[]>;
  /** 계정 → 12개월 (元). 2025 실적 */
  prev: Record<string, number[]>;
  /** 현재 연도 재무조정 (없으면 IFRS 행을 만들지 않는다) */
  ifrs?: ScenarioIFRS;
  /** 전년 재무조정 — IFRS 행 YoY 분모 */
  ifrsPrev?: ScenarioIFRS;
}

export interface PLScenarioResponse {
  year: number;
  baseMonth: number;
  brands: Record<string, ScenarioBrandData>;
}

function brandPath(brand: string, year: number): string {
  return path.join(process.cwd(), '파일', 'PL_brand', brand, `${year}.csv`);
}

/**
 * 리테일매출 7행 — 손익계산서 본표(calculatePL)와 같은 조립.
 *   대리상/직영 = 1~실적월은 의류+ACC 합, 이후는 저장된 플랜(없으면 0)
 *   리테일매출 = 대리상 + 직영
 * 시나리오 규칙이 따로 없어 세 시나리오에서 같은 값으로 흐른다.
 */
function retailSeries(r: RetailPLData): Record<string, number[]> {
  const latest = r.latestActualMonth ?? 0;
  const 대리상 = r.대리상_의류.map((v, i) => (i < latest ? v + r.대리상_ACC[i] : r.대리상_플랜?.[i] ?? 0));
  const 직영 = r.직영_의류.map((v, i) => (i < latest ? v + r.직영_ACC[i] : r.직영_플랜?.[i] ?? 0));
  return {
    '리테일매출': 대리상.map((v, i) => v + 직영[i]),
    '리테일_대리상': 대리상,
    '리테일_대리상_의류': [...r.대리상_의류],
    '리테일_대리상_ACC': [...r.대리상_ACC],
    '리테일_직영': 직영,
    '리테일_직영_의류': [...r.직영_의류],
    '리테일_직영_ACC': [...r.직영_ACC],
  };
}

async function readAccounts(brand: string, year: number): Promise<Record<string, number[]> | null> {
  const p = brandPath(brand, year);
  if (!fs.existsSync(p)) return null;
  const map = createMonthDataMap(await readCSV(p, year));
  const out: Record<string, number[]> = {};
  for (const acc of ACCOUNTS) out[acc] = getAccountValues(map, acc).slice(0, 12);
  // 리테일매출 (2025/2026 만 있다 — 없으면 행이 0 으로 남는다)
  const retail = await loadRetailPLByBrand(year, brand);
  if (retail) Object.assign(out, retailSeries(retail));
  return out;
}

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const brand = (sp.get('brand') ?? 'all').toLowerCase();
    const year = parseInt(sp.get('year') ?? '2026', 10);
    if (brand !== 'all' && !VALID_BRANDS.includes(brand)) {
      return NextResponse.json({ error: '유효하지 않은 브랜드입니다.' }, { status: 400 });
    }
    if (!Number.isInteger(year)) {
      return NextResponse.json({ error: '유효하지 않은 연도입니다.' }, { status: 400 });
    }

    const ids = brand === 'all' ? CORPORATE_PL_BRAND_IDS : [brand];
    const brands: Record<string, ScenarioBrandData> = {};
    const pickIFRS = async (y: number, id: string): Promise<ScenarioIFRS | undefined> => {
      const set = await loadIFRSAdjust(y, id);
      if (!set?.hasData) return undefined;
      return { total: set.total, intercompany: set.intercompany };
    };
    await Promise.all(ids.map(async (id) => {
      const [current, prev, ifrs, ifrsPrev] = await Promise.all([
        readAccounts(id, year), readAccounts(id, year - 1), pickIFRS(year, id), pickIFRS(year - 1, id),
      ]);
      if (!current) return; // 파일 없는 브랜드는 제외
      brands[id] = { current, prev: prev ?? {}, ifrs, ifrsPrev };
    }));

    const payload: PLScenarioResponse = { year, baseMonth: BASE_MONTH, brands };
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('시나리오 API 에러:', error);
    return NextResponse.json({ error: '시나리오 데이터를 불러오지 못했습니다.' }, { status: 500 });
  }
}
