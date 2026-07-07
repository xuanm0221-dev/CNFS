// 손익계산서 — 누적원가율 표 (MLB, MLB KIDS)
// 데이터 소스: public/data/cumulative-cost-rate.json (전처리 스크립트 결과)
// 컬럼: 25년1월~26년N월 + 전체, 행: CN원가율, IMP원가율, CN비중, 가중평균
// 갱신: python scripts/refresh_2026_cumulative_cost_rate.py --baseMonth N
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Brand = 'MLB' | 'MLB KIDS';

export interface CumulativeCostRateBrandData {
  months: string[]; // 25년1월, ..., 26년6월, 전체
  rows: {
    CN원가율: (number | null)[];
    IMP원가율: (number | null)[];
    CN비중: (number | null)[];
    가중평균: (number | null)[];
  };
}

export interface CumulativeCostRateResponse {
  brands: Record<Brand, CumulativeCostRateBrandData>;
  /** 전처리 시점의 기준연도/월 — 스크립트 명령어 표시용 */
  baseYear?: number;
  baseMonth?: number;
}

export async function GET() {
  try {
    const jsonPath = path.join(process.cwd(), 'public', 'data', 'cumulative-cost-rate.json');
    if (!fs.existsSync(jsonPath)) {
      return NextResponse.json(
        { error: '누적원가율 데이터가 없습니다. 전처리 스크립트를 먼저 실행해주세요.' },
        { status: 404 },
      );
    }
    const content = fs.readFileSync(jsonPath, 'utf-8');
    const data = JSON.parse(content) as CumulativeCostRateResponse;

    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `누적원가율 조회 오류: ${message}` }, { status: 500 });
  }
}
