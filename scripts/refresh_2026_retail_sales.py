"""
2026년 리테일매출(출하매출) 전처리 스크립트
==========================================
로컬 Next.js 서버(localhost:3000)에 API 요청 → Snowflake 조회 →
public/data/inventory/2026/retail-sales-{brand}.json 저장

사용법:
  python scripts/refresh_2026_retail_sales.py --baseMonth 2                          # 1~2월 실적
  python scripts/refresh_2026_retail_sales.py --baseMonth 3 --growthRate 5           # 성장률 지정
  python scripts/refresh_2026_retail_sales.py --baseMonth 2 --brand MLB              # MLB만

필수 조건:
  1. npm run dev 로 Next.js 서버 실행 중
  2. .env.local 에 Snowflake 인증정보 설정 완료
  3. pip install requests (없으면 설치)
"""

import argparse
import json
import os
import sys
import time
import requests

BASE_URL = "http://localhost:3000"
ENDPOINT = "retail-sales"
YEAR = 2026

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(SCRIPT_DIR, '..', 'public', 'data', 'inventory', '2026')

ALL_BRANDS = ["MLB", "MLB KIDS", "DISCOVERY"]


def check_server():
    try:
        requests.get(BASE_URL, timeout=5)
        return True
    except requests.exceptions.ConnectionError:
        return False


def save_json(brand: str, data: dict) -> None:
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    safe_brand = brand.replace(' ', '_')
    filename = f"{ENDPOINT}-{safe_brand}.json"
    filepath = os.path.join(OUTPUT_DIR, filename)
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    print(f"  → 저장: {filename}")


def fetch_brand(brand: str, closed_through: str, growth_rate: float, growth_rate_hq: float) -> bool:
    url = (
        f"{BASE_URL}/api/inventory/{ENDPOINT}"
        f"?year={YEAR}"
        f"&brand={requests.utils.quote(brand)}"
        f"&closedThrough={closed_through}"
        f"&growthRate={growth_rate}"
        f"&growthRateHq={growth_rate_hq}"
    )
    try:
        r = requests.get(url, timeout=180)
        if r.status_code == 200:
            data = r.json()
            if "error" in data:
                print(f"  ✗ {brand}: {data['error']}")
                return False
            size_kb = len(r.content) / 1024
            print(f"  ✓ {brand:<12} ({size_kb:.1f} KB)")
            save_json(brand, data)
            return True
        else:
            print(f"  ✗ {brand}: HTTP {r.status_code}")
            return False
    except requests.exceptions.Timeout:
        print(f"  ✗ {brand}: 타임아웃 (Snowflake 연결 확인 필요)")
        return False
    except Exception as e:
        print(f"  ✗ {brand}: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description="2026년 리테일매출 전처리")
    parser.add_argument(
        "--baseMonth",
        type=int,
        required=True,
        choices=range(1, 13),
        metavar="N",
        help="실적 기준월 (1~12). 1~N월 데이터를 Snowflake에서 조회합니다.",
    )
    parser.add_argument(
        "--brand",
        choices=ALL_BRANDS,
        default=None,
        help="특정 브랜드만 갱신 (미지정 시 전체 3개 브랜드)",
    )
    parser.add_argument(
        "--growthRate",
        type=float,
        default=5.0,
        help="대리점 리테일 성장률 %% (기본값: 5)",
    )
    parser.add_argument(
        "--growthRateHq",
        type=float,
        default=10.0,
        help="본사 리테일 성장률 %% (기본값: 10)",
    )
    args = parser.parse_args()

    closed_through = f"{YEAR}{args.baseMonth:02d}"
    brands = [args.brand] if args.brand else ALL_BRANDS

    print("=" * 55)
    print(f"  2026년 리테일매출 전처리  (실적: 1~{args.baseMonth}월)")
    print(f"  closedThrough={closed_through}  growthRate={args.growthRate}%  growthRateHq={args.growthRateHq}%")
    print("=" * 55)

    if not check_server():
        print("\n❌ Next.js 서버에 연결할 수 없습니다.")
        print("   → 터미널에서 'npm run dev' 실행 후 다시 시도하세요.\n")
        sys.exit(1)
    print("✓ Next.js 서버 연결 확인\n")

    total = len(brands)
    success = 0
    for brand in brands:
        ok = fetch_brand(brand, closed_through, args.growthRate, args.growthRateHq)
        if ok:
            success += 1
        time.sleep(0.5)

    print()
    print("=" * 55)
    print(f"  완료: {success}/{total} 성공")
    print("=" * 55)
    if success < total:
        sys.exit(1)


if __name__ == "__main__":
    main()
