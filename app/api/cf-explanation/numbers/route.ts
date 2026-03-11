import { NextResponse } from 'next/server';
import { getCFExplanationSummaryNumbers } from '@/lib/cf-explanation-data';

export async function GET() {
  try {
    const numbers = await getCFExplanationSummaryNumbers();
    return NextResponse.json(numbers);
  } catch (e) {
    console.error('cf-explanation/numbers error:', e);
    return NextResponse.json({}, { status: 500 });
  }
}
