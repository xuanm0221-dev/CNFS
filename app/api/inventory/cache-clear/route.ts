import { NextResponse } from 'next/server';
import { clear2025Cache, get2025CacheSize } from '@/lib/inventory-2025-cache';

export async function POST() {
  const sizeBefore = await get2025CacheSize();
  const deleted = await clear2025Cache();
  return NextResponse.json({
    success: true,
    message: `2025년 캐시 초기화 완료 (${deleted}개 파일 삭제, 기존 ${sizeBefore}개)`,
  });
}

export async function GET() {
  const size = await get2025CacheSize();
  return NextResponse.json({
    cacheSize: size,
    message: `현재 캐시 파일 수: ${size}`,
  });
}
