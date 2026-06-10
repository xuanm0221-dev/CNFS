// 연말기준 운전자본 snapshot — 현금흐름표 탭에서 "운전자본 저장" 클릭 시 호출
// POST: 4개 값 (직영AR/대리상AR/본사AP/제품AP) + savedAt 저장
// GET: snapshot JSON 읽어 반환 (없으면 null)
// 저장 위치: 파일/연말기준운전자본_snapshot.json (git commit 가능, vercel 배포 함께)
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface WcSnapshot {
  savedAt: string;
  wc_ar_direct: number;
  wc_ar_dealer: number;
  wc_ap_hq: number;
  wc_ap_goods: number;
}

function getFilePath(): string {
  return path.join(process.cwd(), '파일', '연말기준운전자본_snapshot.json');
}

export async function GET() {
  try {
    const fp = getFilePath();
    if (!fs.existsSync(fp)) {
      return NextResponse.json(null, { headers: { 'Cache-Control': 'no-store' } });
    }
    const raw = fs.readFileSync(fp, 'utf-8');
    const data = JSON.parse(raw);
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `wc-snapshot 조회 오류: ${msg}` }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const wc_ar_direct = Number(body?.wc_ar_direct);
    const wc_ar_dealer = Number(body?.wc_ar_dealer);
    const wc_ap_hq = Number(body?.wc_ap_hq);
    const wc_ap_goods = Number(body?.wc_ap_goods);

    for (const [k, v] of Object.entries({ wc_ar_direct, wc_ar_dealer, wc_ap_hq, wc_ap_goods })) {
      if (!Number.isFinite(v)) {
        return NextResponse.json({ error: `${k} 값이 유효하지 않습니다: ${v}` }, { status: 400 });
      }
    }

    const snapshot: WcSnapshot = {
      savedAt: new Date().toISOString(),
      wc_ar_direct,
      wc_ar_dealer,
      wc_ap_hq,
      wc_ap_goods,
    };

    const fp = getFilePath();
    fs.writeFileSync(fp, JSON.stringify(snapshot, null, 2), 'utf-8');

    return NextResponse.json({ success: true, savedAt: snapshot.savedAt }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `wc-snapshot 저장 오류: ${msg}` }, { status: 500 });
  }
}
