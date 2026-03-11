"""
2025년 재고자산 데이터 갱신 스크립트
======================================
로컬 Next.js 서버(localhost:3000)에 API 요청 → Snowflake 조회 →
data/inventory/2025/*.json 자동 저장

사용법:
  python scripts/refresh_2025_data.py                          # 전체 갱신
  python scripts/refresh_2025_data.py --type retail-sales      # 리테일만 갱신
  python scripts/refresh_2025_data.py --brand MLB              # MLB만 갱신
  python scripts/refresh_2025_data.py --type retail-sales --brand MLB  # 특정

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

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PUBLIC_CACHE_DIR = os.path.join(SCRIPT_DIR, '..', 'public', 'data', 'inventory', '2025')

ALL_BRANDS = ["MLB", "MLB KIDS", "DISCOVERY"]
ALL_TYPES = ["monthly-stock", "retail-sales", "shipment-sales", "purchase"]


def check_server():
    """Next.js 서버 실행 여부 확인"""
    try:
        r = requests.get(BASE_URL, timeout=5)
        return True
    except requests.exceptions.ConnectionError:
        return False


def clear_cache():
    """기존 2025년 캐시 파일 초기화"""
    print("캐시 초기화 중...")
    try:
        r = requests.post(f"{BASE_URL}/api/inventory/cache-clear", timeout=10)
        data = r.json()
        print(f"  ✓ {data.get('message', '완료')}")
    except Exception as e:
        print(f"  ⚠ 캐시 초기화 실패: {e}")


def save_to_public(endpoint: str, brand: str, data: dict) -> None:
    """API 응답을 public/data/inventory/2025/ 에 저장 (브라우저 정적 서빙용)"""
    os.makedirs(PUBLIC_CACHE_DIR, exist_ok=True)
    safe_brand = brand.replace(' ', '_')
    filename = f"{endpoint}-{safe_brand}.json"
    filepath = os.path.join(PUBLIC_CACHE_DIR, filename)
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    print(f"  → public 저장: {filename}")


def fetch_data(endpoint: str, brand: str) -> bool:
    """단일 엔드포인트 + 브랜드 조회 (캐시 없으면 Snowflake → JSON 저장)"""
    url = f"{BASE_URL}/api/inventory/{endpoint}?year=2025&brand={requests.utils.quote(brand)}"
    try:
        r = requests.get(url, timeout=120)
        if r.status_code == 200:
            data = r.json()
            if "error" in data:
                print(f"  ✗ {endpoint} / {brand}: {data['error']}")
                return False
            size_kb = len(r.content) / 1024
            print(f"  ✓ {endpoint:<20} {brand:<12} ({size_kb:.1f} KB)")
            save_to_public(endpoint, brand, data)
            return True
        else:
            print(f"  ✗ {endpoint} / {brand}: HTTP {r.status_code}")
            return False
    except requests.exceptions.Timeout:
        print(f"  ✗ {endpoint} / {brand}: 타임아웃 (Snowflake 연결 확인 필요)")
        return False
    except Exception as e:
        print(f"  ✗ {endpoint} / {brand}: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description="2025년 재고자산 데이터 갱신")
    parser.add_argument(
        "--type",
        choices=ALL_TYPES,
        default=None,
        help="특정 데이터 타입만 갱신 (미지정 시 전체)",
    )
    parser.add_argument(
        "--brand",
        choices=["MLB", "MLB KIDS", "DISCOVERY"],
        default=None,
        help="특정 브랜드만 갱신 (미지정 시 전체)",
    )
    parser.add_argument(
        "--no-clear",
        action="store_true",
        help="캐시 초기화 생략 (기존 캐시 유지)",
    )
    args = parser.parse_args()

    types = [args.type] if args.type else ALL_TYPES
    brands = [args.brand] if args.brand else ALL_BRANDS

    print("=" * 55)
    print("  2025년 재고자산 데이터 갱신")
    print("=" * 55)

    # 서버 확인
    if not check_server():
        print("\n❌ Next.js 서버에 연결할 수 없습니다.")
        print("   → 터미널에서 'npm run dev' 실행 후 다시 시도하세요.\n")
        sys.exit(1)
    print("✓ Next.js 서버 연결 확인")

    # 캐시 초기화 (전체 갱신 시만, --no-clear 아닌 경우)
    if not args.no_clear and not args.type and not args.brand:
        clear_cache()
    else:
        print("캐시 초기화 생략 (특정 항목 갱신 또는 --no-clear 옵션)")

    # 데이터 조회
    print(f"\n조회 대상: {types}")
    print(f"브랜드:    {brands}\n")

    total = len(types) * len(brands)
    success = 0

    for ep in types:
        for brand in brands:
            ok = fetch_data(ep, brand)
            if ok:
                success += 1
            time.sleep(0.5)  # 서버 부하 방지

    # 결과 요약
    print()
    print("=" * 55)
    print(f"  완료: {success}/{total} 성공")
    print("=" * 55)

    if success == total:
        print("\n✅ 모든 데이터 갱신 완료!")
        print("\n다음 단계:")
        print("  git add data/inventory/2025/ public/data/inventory/2025/")
        print('  git commit -m "2025 데이터 갱신"')
        print("  git push")
        print("  → Vercel 자동 재배포 후 모든 사람이 확인 가능\n")
    else:
        failed = total - success
        print(f"\n⚠ {failed}개 항목 실패. Snowflake 연결 및 .env.local 확인 필요.\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
