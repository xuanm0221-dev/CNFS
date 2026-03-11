import { promises as fs } from 'fs';
import path from 'path';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const DATA_DIR = path.join(process.cwd(), 'data', 'inventory');
const SNAPSHOT_FILE = path.join(DATA_DIR, 'snapshots.json');
const ANNUAL_PLAN_FILE = path.join(DATA_DIR, 'annual-shipment-plan.json');
const OTB_PLAN_FILE = path.join(DATA_DIR, 'otb-plan.json');

const DEFAULT_ANNUAL_PLAN = {
  '2026': {
    MLB: {
      currF: 2654771,
      currS: 2510618,
      year1: 367886,
      year2: 75568,
      next: 252171,
      past: 63235,
    },
    'MLB KIDS': {
      currF: 129632,
      currS: 106274,
      year1: 34605,
      year2: 27134,
      next: 15039,
      past: 13250,
    },
    DISCOVERY: {
      currF: 135258,
      currS: 76187,
      year1: 96559,
      year2: 3962,
      next: 4989,
      past: 0,
    },
  },
} as const;

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readJsonFile<T extends JsonValue>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    await ensureDir();
    await fs.writeFile(filePath, JSON.stringify(fallback, null, 2), 'utf8');
    return fallback;
  }
}

async function writeJsonFile<T extends JsonValue>(filePath: string, data: T): Promise<void> {
  await ensureDir();
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

export async function readSnapshotsStore(): Promise<Record<string, JsonValue>> {
  return readJsonFile<Record<string, JsonValue>>(SNAPSHOT_FILE, {});
}

export async function writeSnapshotsStore(store: Record<string, JsonValue>): Promise<void> {
  await writeJsonFile(SNAPSHOT_FILE, store);
}

export async function readAnnualPlanStore(): Promise<Record<string, JsonValue>> {
  return readJsonFile<Record<string, JsonValue>>(ANNUAL_PLAN_FILE, DEFAULT_ANNUAL_PLAN as unknown as Record<string, JsonValue>);
}

export async function writeAnnualPlanStore(store: Record<string, JsonValue>): Promise<void> {
  await writeJsonFile(ANNUAL_PLAN_FILE, store);
}

export async function readOtbStore(): Promise<Record<string, Record<string, number>>> {
  return readJsonFile<Record<string, Record<string, number>>>(OTB_PLAN_FILE, {});
}

export async function writeOtbStore(store: Record<string, Record<string, number>>): Promise<void> {
  await writeJsonFile(OTB_PLAN_FILE, store);
}

export function snapshotStoreKey(year: number, brand: string): string {
  return `${year}:${brand}`;
}

