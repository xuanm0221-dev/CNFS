import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { CFExplanationContent } from '@/lib/types';
import { getCFExplanationSummaryNumbers } from '@/lib/cf-explanation-data';
import { generateCFExplanationContent } from '@/lib/cf-explanation-generator';

export type { CFExplanationContent };

export async function GET(request: NextRequest) {
  const requirePassword = process.env.VERCEL === '1';
  const isDeploy = process.env.VERCEL === '1';
  const refresh = request.nextUrl.searchParams.get('refresh') === '1';
  const kvKey = request.nextUrl.searchParams.get('key') ?? 'cf-explanation';

  try {
    let stored: CFExplanationContent | null = null;
    if (!refresh && isDeploy) {
      stored = (await kv.get(kvKey)) as CFExplanationContent | null;
    }
    if (stored != null) {
      return NextResponse.json({ content: stored, requirePassword });
    }
    const numbers = await getCFExplanationSummaryNumbers();
    const content = generateCFExplanationContent(numbers);
    return NextResponse.json({ content, requirePassword });
  } catch (e) {
    console.error('cf-explanation GET error:', e);
    return NextResponse.json(
      { content: null, error: '설명을 불러오지 못했습니다.', requirePassword },
      { status: 200 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as { password?: string; content?: CFExplanationContent; key?: string };
    const requirePassword = process.env.VERCEL === '1';
    if (requirePassword && body.password !== '1234') {
      return NextResponse.json(
        { error: '비밀번호가 올바르지 않습니다.' },
        { status: 401 }
      );
    }
    if (body.content) {
      const kvKey = body.key ?? 'cf-explanation';
      await kv.set(kvKey, body.content);
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('cf-explanation POST error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
