// PL(sim) 재무조정 — IFRS 조정 상세(재무조정/{year}_상세.csv) 시리즈를 내려준다.
//
// 구 {year}.csv (재무&관리차이 방식) 기반 응답은 PL(sim) 이 더 이상 쓰지 않아 제거했다.
// 2024 처럼 상세파일이 없는 연도는 ifrs 가 null 이고, PL(sim) 은 (IFRS) 블록을 그리지 않는다.
import { NextRequest, NextResponse } from 'next/server';
import { loadIFRSAdjust } from '@/lib/ifrs-adjust-loader';
import { CORPORATE_PL_BRAND_IDS } from '@/lib/fs-mapping';
import type { IFRSAdjustSet } from '@/lib/ifrs-adjust';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const yearRaw = req.nextUrl.searchParams.get('year') ?? '2026';
    const year = Number(yearRaw);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return NextResponse.json({ error: '유효한 year 파라미터가 필요합니다.' }, { status: 400 });
    }

    const ifrsTotal = (await loadIFRSAdjust(year)) ?? null;
    const ifrsByBrand: Record<string, IFRSAdjustSet> = {};
    if (ifrsTotal) {
      for (const brand of CORPORATE_PL_BRAND_IDS) {
        const set = await loadIFRSAdjust(year, brand);
        if (set?.hasData) ifrsByBrand[brand] = set;
      }
    }

    return NextResponse.json(
      { year, ifrs: ifrsTotal ? { total: ifrsTotal, byBrand: ifrsByBrand } : null },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return NextResponse.json({ year: 2026, ifrs: null }, { headers: { 'Cache-Control': 'no-store' } });
  }
}
