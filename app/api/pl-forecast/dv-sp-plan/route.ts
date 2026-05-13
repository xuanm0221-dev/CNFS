// DUVETICA / SUPRA 연간 계획 — 파일/PL_brand/{brand}/{year}.csv에서 통합 로드
// (이전: 별도 보조파일(simu)/DV,SP연간plan/{BRAND}.csv 사용. CSV 단위는 1위안 — ×1000 변환 없음)
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Brand = 'DUVETICA' | 'SUPRA';
type Channel = 'dealer' | 'direct';

interface BrandPlan {
  tag: Record<Channel, (number | null)[]> & { dealerCloth: (number | null)[]; dealerAcc: (number | null)[] };
  sales: Record<Channel, (number | null)[]> & { dealerCloth: (number | null)[]; dealerAcc: (number | null)[] };
  retail: Record<Channel, (number | null)[]>;
  accounts: Record<string, (number | null)[]>;
}

type CsvRow = Record<string, string>;

const BRANDS: Brand[] = ['DUVETICA', 'SUPRA'];
const BRAND_TO_DIR: Record<Brand, string> = {
  DUVETICA: 'duvetica',
  SUPRA: 'supra',
};
const MONTH_KEYS = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];

// PL_brand CSV는 직접비/영업비 등을 1행 1계정 구조로 보유.
// 본 API는 PL(sim)에서 plan.accounts[acc] 로 참조되므로 그대로 매핑.
// account 컬럼 (PL_brand CSV) → BrandPlan 필드 매핑
//   Tag매출_대리상_APP  → tag.dealerCloth
//   Tag매출_대리상_ACC  → tag.dealerAcc
//   Tag매출_직영_APP    → tag.direct (직영_APP + 직영_ACC 합산)
//   Tag매출_직영_ACC    → tag.direct (위와 합)
//   리테일매출_대리상   → retail.dealer
//   리테일매출_직영     → retail.direct
//   실판매출            → sales.dealer (분해 정보 없으면 dealer 단일 사용; sales.direct/dealerCloth/dealerAcc는 null 유지)
//   그 외(매출원가/평가감/직접비/영업비 등) → accounts[name]
//   Tag매출 (총합 행)  → 무시 (4-leaf로 자동 합산되므로)

function empty12(): (number | null)[] {
  return new Array(12).fill(null);
}

function makeBrandPlan(): BrandPlan {
  return {
    tag: { dealer: empty12(), direct: empty12(), dealerCloth: empty12(), dealerAcc: empty12() },
    sales: { dealer: empty12(), direct: empty12(), dealerCloth: empty12(), dealerAcc: empty12() },
    retail: { dealer: empty12(), direct: empty12() },
    accounts: {},
  };
}

function toNullableNumber(value: string | undefined): number | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function addNullable(a: number | null, b: number | null): number | null {
  if (a == null && b == null) return null;
  return (a ?? 0) + (b ?? 0);
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const yearParam = searchParams.get('year');
    const year = yearParam ? parseInt(yearParam, 10) : 2026;
    if (![2024, 2025, 2026].includes(year)) {
      return NextResponse.json({ error: 'year는 2024/2025/2026 중 하나여야 합니다.' }, { status: 400 });
    }

    const result: Record<Brand, BrandPlan> = {
      DUVETICA: makeBrandPlan(),
      SUPRA: makeBrandPlan(),
    };

    for (const brand of BRANDS) {
      const csvPath = path.join(process.cwd(), '파일', 'PL_brand', BRAND_TO_DIR[brand], `${year}.csv`);
      if (!fs.existsSync(csvPath)) continue;
      const content = fs.readFileSync(csvPath, 'utf-8').replace(/^﻿/, '');
      const parsed = Papa.parse<CsvRow>(content, { header: true, skipEmptyLines: true });
      const bd = result[brand];

      for (const row of parsed.data) {
        const account = (row['계정과목'] ?? '').trim();
        if (!account) continue;

        for (let i = 0; i < 12; i += 1) {
          const v = toNullableNumber(row[MONTH_KEYS[i]]);
          if (v === null) continue;

          if (account === 'Tag매출') {
            // 총합 행 — leaf 합산으로 재구성되므로 무시
            continue;
          }
          if (account === 'Tag매출_대리상_APP') {
            bd.tag.dealerCloth[i] = v;
            continue;
          }
          if (account === 'Tag매출_대리상_ACC') {
            bd.tag.dealerAcc[i] = v;
            continue;
          }
          if (account === 'Tag매출_직영_APP' || account === 'Tag매출_직영_ACC') {
            bd.tag.direct[i] = addNullable(bd.tag.direct[i], v);
            continue;
          }
          if (account === '리테일매출_대리상') {
            bd.retail.dealer[i] = v;
            continue;
          }
          if (account === '리테일매출_직영') {
            bd.retail.direct[i] = v;
            continue;
          }
          if (account === '실판매출') {
            bd.sales.dealer[i] = v;
            continue;
          }
          // 그 외 모든 계정: accounts[account]
          if (!bd.accounts[account]) bd.accounts[account] = empty12();
          bd.accounts[account][i] = v;
        }
      }

      // tag.dealer = dealerCloth + dealerAcc
      for (let i = 0; i < 12; i += 1) {
        const tc = bd.tag.dealerCloth[i];
        const ta = bd.tag.dealerAcc[i];
        if (tc !== null || ta !== null) bd.tag.dealer[i] = (tc ?? 0) + (ta ?? 0);
      }
    }

    return NextResponse.json({ year, brands: result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `DV/SP 계획 CSV 조회 오류: ${message}` }, { status: 500 });
  }
}
