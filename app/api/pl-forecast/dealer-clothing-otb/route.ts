import { NextRequest, NextResponse } from 'next/server';
import {
  readDealerClothingSellinStore,
  writeDealerClothingSellinStore,
  DealerClothingSellin,
} from '@/lib/inventory-file-store';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const data = await readDealerClothingSellinStore();
    return NextResponse.json({ values: data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      values?: DealerClothingSellin;
    };
    if (!body.values || typeof body.values !== 'object') {
      return NextResponse.json({ error: 'values is required' }, { status: 400 });
    }
    await writeDealerClothingSellinStore(body.values);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
