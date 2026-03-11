import { NextRequest, NextResponse } from 'next/server';
import { fetchOtbData, OtbData, OtbSeason, OtbBrand } from '@/lib/otb-db';
import { readOtbStore, writeOtbStore } from '@/lib/inventory-file-store';

export const runtime = 'nodejs';

export interface OtbResponse {
  year: number;
  data: OtbData;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const year = Number(searchParams.get('year') ?? '2026');

  if (year !== 2026) {
    return NextResponse.json({ year, data: null });
  }

  try {
    const data = await fetchOtbData();

    // 파일 저장값(CNY K)으로 하드코딩 값 오버레이
    const fileStore = await readOtbStore();
    for (const [sesn, brands] of Object.entries(fileStore)) {
      for (const [brand, valueK] of Object.entries(brands)) {
        if (data[sesn as OtbSeason]) {
          data[sesn as OtbSeason][brand as OtbBrand] = (valueK as number) * 1000;
        }
      }
    }

    return NextResponse.json({ year, data } satisfies OtbResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[OTB API] error:', message);
    return NextResponse.json(
      { error: `대리상 OTB 조회 오류: ${message}` },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      data?: Record<string, Record<string, number>>;
    };
    if (!body.data) {
      return NextResponse.json({ error: 'data is required' }, { status: 400 });
    }
    await writeOtbStore(body.data);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[OTB API] POST error:', err);
    return NextResponse.json({ error: 'Failed to save OTB data' }, { status: 500 });
  }
}
