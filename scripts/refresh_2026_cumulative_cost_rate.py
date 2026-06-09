"""
누적원가율 전처리 스크립트 (손익계산서 탭 최하단 표)
==========================================
로컬 Next.js 서버에 API 요청 → Snowflake 조회 → public/data/cumulative-cost-rate.json 저장

사용법:
  python scripts/refresh_2026_cumulative_cost_rate.py --baseMonth 5
  python scripts/refresh_2026_cumulative_cost_rate.py --baseMonth 6 --baseYear 2026

증분 방식:
  - --baseMonth 5 → 2025-01 ~ 2026-05 까지 누적
  - --baseMonth 6 → 2025-01 ~ 2026-06 까지 누적 (6월 결산 시점)
  - 매월 결산 후 --baseMonth 만 증가시켜 실행하면 JSON 이 누적 갱신됨

필수 조건:
  1. npm run dev 로 Next.js 서버 실행 중
  2. .env.local 에 Snowflake 인증정보 설정 완료
  3. pip install requests
"""

import argparse
import json
import os
import sys
import requests

BASE_URL = 'http://localhost:3000'
ENDPOINT = '/api/pl-forecast/cumulative-cost-rate-snowflake'
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
JSON_PATH = os.path.join(SCRIPT_DIR, '..', 'public', 'data', 'cumulative-cost-rate.json')


def check_server() -> bool:
    try:
        requests.get(BASE_URL, timeout=5)
        return True
    except requests.exceptions.ConnectionError:
        return False


def fetch(base_year: int, base_month: int) -> dict:
    url = f'{BASE_URL}{ENDPOINT}?baseYear={base_year}&baseMonth={base_month}'
    r = requests.get(url, timeout=300)
    if r.status_code != 200:
        raise RuntimeError(f'API HTTP {r.status_code}: {r.text[:200]}')
    data = r.json()
    if 'error' in data:
        raise RuntimeError(f"API error: {data['error']}")
    return data


def write_json(data: dict) -> None:
    os.makedirs(os.path.dirname(JSON_PATH), exist_ok=True)
    with open(JSON_PATH, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    size_kb = os.path.getsize(JSON_PATH) / 1024
    rel = os.path.relpath(JSON_PATH, os.path.join(SCRIPT_DIR, '..'))
    print(f'\n✓ JSON 저장 완료: {rel} ({size_kb:.1f} KB)')


def main() -> None:
    parser = argparse.ArgumentParser(description='누적원가율 전처리 (MLB, MLB KIDS)')
    parser.add_argument(
        '--baseMonth',
        type=int,
        required=True,
        choices=range(1, 13),
        metavar='N',
        help='기준월 (1~12). 2025-01 ~ baseYear-N월말일 까지 누적 조회',
    )
    parser.add_argument(
        '--baseYear',
        type=int,
        default=2026,
        help='기준연도 (기본값: 2026)',
    )
    args = parser.parse_args()

    print('=' * 55)
    print(f'  누적원가율 전처리 (브랜드: MLB, MLB KIDS)')
    print(f'  범위: 2025-01-01 ~ {args.baseYear}-{args.baseMonth:02d}-말일')
    print('=' * 55)

    if not check_server():
        print('\n❌ Next.js 서버에 연결할 수 없습니다.')
        print('   → 터미널에서 "npm run dev" 실행 후 다시 시도하세요.\n')
        sys.exit(1)
    print('✓ Next.js 서버 연결 확인')

    print('\n· Snowflake 조회 중... (수 초~수십 초 소요)')
    try:
        data = fetch(args.baseYear, args.baseMonth)
    except Exception as e:
        print(f'\n❌ Snowflake 조회 실패: {e}')
        sys.exit(1)

    write_json(data)

    print('\n=' + '=' * 54)
    print('  완료. git add public/data/cumulative-cost-rate.json && commit + push')
    print('=' * 55)


if __name__ == '__main__':
    main()
