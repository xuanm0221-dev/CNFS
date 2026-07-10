import { NextRequest, NextResponse } from 'next/server';
import { fetchOtbData, OtbData, OtbSourceMap } from '@/lib/otb-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface OtbResponse {
  year: number;
  data: OtbData;
  source?: OtbSourceMap; // 셀별 SF(Snowflake) / HC(하드코딩) 출처
}

// 대리상 OTB = max(하드코딩 목표/계획, Snowflake 실제). 수기 오버레이(otb-plan.json) 폐지.
// 계획 변경 시 lib/otb-db.ts 의 하드코딩 값을 직접 수정.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const year = Number(searchParams.get('year') ?? '2026');

  if (year !== 2026) {
    return NextResponse.json({ year, data: null });
  }

  try {
    const { data, source } = await fetchOtbData();
    return NextResponse.json({ year, data, source } satisfies OtbResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[OTB API] error:', message);
    return NextResponse.json(
      { error: `대리상 OTB 조회 오류: ${message}` },
      { status: 500 },
    );
  }
}
