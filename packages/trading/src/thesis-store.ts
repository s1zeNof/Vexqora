import fs from "node:fs";
import path from "node:path";

export interface TradeThesisDiff {
  statusChanged: boolean;
  previousStatus?: string | undefined;
  newStatus?: string | undefined;
  invalidationPriceChanged?: boolean | undefined;
  previousInvalidationPrice?: number | undefined;
  newInvalidationPrice?: number | undefined;
  addedOpposingEvidence: string[];
  removedOpposingEvidence: string[];
  summary: string;
}

export interface TradeThesis {
  thesisId: string;
  tradeId?: string | undefined;
  accountId?: string | undefined;
  symbol: string;
  side: "long" | "short" | "neutral";
  status: "VALID" | "WEAKENED" | "INVALIDATED";
  revision: number;
  entryPrice: number;
  invalidationPrice: number;
  primaryRationale: string;
  invalidationTrigger: string;
  supportingEvidence: string[];
  opposingEvidence: string[];
  diffFromPrevious?: TradeThesisDiff | undefined;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface SupabaseClientLike {
  from: (table: string) => {
    insert: (data: Record<string, unknown>) => Promise<{ error: Error | null }>;
    select: (cols: string) => {
      eq: (col: string, val: unknown) => {
        order: (col: string, opts: { ascending: boolean }) => Promise<{ data: Record<string, unknown>[] | null; error: Error | null }>;
      };
    };
  };
}

function resolveDefaultStorageDir(): string {
  const cwd = process.cwd();
  if (cwd.includes("packages") || cwd.includes("apps")) {
    // If running within workspace subdirectory
    const repoRoot = path.resolve(cwd, "../..");
    return path.resolve(repoRoot, "packages/data-lake/theses");
  }
  return path.resolve(cwd, "packages/data-lake/theses");
}

export class DurableTradeThesisStore {
  private memoryStore = new Map<string, TradeThesis>();
  private historyStore = new Map<string, TradeThesis[]>();
  private storageDir: string;
  private supabaseClient?: SupabaseClientLike | undefined;

  constructor(options?: { storageDir?: string; supabaseClient?: SupabaseClientLike }) {
    this.storageDir = options?.storageDir ?? resolveDefaultStorageDir();
    this.supabaseClient = options?.supabaseClient;
    this.initStorageDir();
  }

  private initStorageDir(): void {
    try {
      if (!fs.existsSync(this.storageDir)) {
        fs.mkdirSync(this.storageDir, { recursive: true });
      }
    } catch {
      // Ignore directory creation errors in constrained test environments
    }
  }

  private sanitizeFilename(id: string): string {
    return id.replace(/[^a-zA-Z0-9_-]/g, "_");
  }

  /**
   * Saves or updates a thesis.
   * If thesis exists, automatically computes diff, increments revision, and stores audit history.
   */
  async saveThesis(thesis: TradeThesis): Promise<TradeThesis> {
    const existing = await this.getThesis(thesis.thesisId);
    const now = Date.now();

    let savedThesis: TradeThesis;

    if (existing) {
      const addedOpposing = thesis.opposingEvidence.filter(e => !existing.opposingEvidence.includes(e));
      const removedOpposing = existing.opposingEvidence.filter(e => !thesis.opposingEvidence.includes(e));
      const statusChanged = existing.status !== thesis.status;
      const invalidationChanged = existing.invalidationPrice !== thesis.invalidationPrice;

      const diffSummaryParts: string[] = [];
      if (statusChanged) diffSummaryParts.push(`Status: ${existing.status} -> ${thesis.status}`);
      if (invalidationChanged) diffSummaryParts.push(`Invalidation: ${existing.invalidationPrice} -> ${thesis.invalidationPrice}`);
      if (addedOpposing.length > 0) diffSummaryParts.push(`Added opposing: ${addedOpposing.join(", ")}`);

      const diff: TradeThesisDiff = {
        statusChanged,
        previousStatus: existing.status,
        newStatus: thesis.status,
        invalidationPriceChanged: invalidationChanged,
        previousInvalidationPrice: existing.invalidationPrice,
        newInvalidationPrice: thesis.invalidationPrice,
        addedOpposingEvidence: addedOpposing,
        removedOpposingEvidence: removedOpposing,
        summary: diffSummaryParts.length > 0 ? diffSummaryParts.join("; ") : "No material changes"
      };

      savedThesis = {
        ...thesis,
        revision: existing.revision + 1,
        createdAtMs: existing.createdAtMs,
        updatedAtMs: now,
        diffFromPrevious: diff
      };
    } else {
      savedThesis = {
        ...thesis,
        revision: thesis.revision || 1,
        createdAtMs: thesis.createdAtMs || now,
        updatedAtMs: now
      };
    }

    // 1. In-memory update
    this.memoryStore.set(savedThesis.thesisId, savedThesis);
    const history = this.historyStore.get(savedThesis.thesisId) ?? [];
    history.push(savedThesis);
    this.historyStore.set(savedThesis.thesisId, history);

    // 2. Local durable file storage
    try {
      const safeName = this.sanitizeFilename(savedThesis.thesisId);
      const filePath = path.join(this.storageDir, `${safeName}.json`);
      const histPath = path.join(this.storageDir, `${safeName}.history.json`);

      fs.writeFileSync(filePath, JSON.stringify(savedThesis, null, 2), "utf8");
      fs.writeFileSync(histPath, JSON.stringify(history, null, 2), "utf8");
    } catch {
      // File system write failure non-fatal if running in restricted container
    }

    // 3. Supabase DB persistence if configured
    if (this.supabaseClient) {
      try {
        await this.supabaseClient.from("trade_theses").insert({
          thesis_key: savedThesis.thesisId,
          trade_id: savedThesis.tradeId ?? null,
          account_id: savedThesis.accountId ?? null,
          symbol: savedThesis.symbol,
          side: savedThesis.side,
          status: savedThesis.status,
          revision: savedThesis.revision,
          entry_price: savedThesis.entryPrice,
          invalidation_price: savedThesis.invalidationPrice,
          primary_rationale: savedThesis.primaryRationale,
          invalidation_trigger: savedThesis.invalidationTrigger,
          supporting_evidence: savedThesis.supportingEvidence,
          opposing_evidence: savedThesis.opposingEvidence,
          diff_from_previous: savedThesis.diffFromPrevious ?? {},
          created_at: new Date(savedThesis.createdAtMs).toISOString(),
          updated_at: new Date(savedThesis.updatedAtMs).toISOString()
        });
      } catch {
        // DB insert log
      }
    }

    return savedThesis;
  }

  /**
   * Retrieves current thesis by ID. Checks memory first, then durable disk.
   */
  async getThesis(thesisId: string): Promise<TradeThesis | null> {
    await Promise.resolve();
    if (this.memoryStore.has(thesisId)) {
      return this.memoryStore.get(thesisId)!;
    }

    try {
      const safeName = this.sanitizeFilename(thesisId);
      const filePath = path.join(this.storageDir, `${safeName}.json`);
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, "utf8");
        const loaded = JSON.parse(raw) as TradeThesis;
        this.memoryStore.set(thesisId, loaded);
        return loaded;
      }
    } catch {
      // Fallback
    }

    return null;
  }

  /**
   * Retrieves full revision history of a thesis.
   */
  async getThesisHistory(thesisId: string): Promise<TradeThesis[]> {
    if (this.historyStore.has(thesisId)) {
      return this.historyStore.get(thesisId)!;
    }

    try {
      const safeName = this.sanitizeFilename(thesisId);
      const histPath = path.join(this.storageDir, `${safeName}.history.json`);
      if (fs.existsSync(histPath)) {
        const raw = fs.readFileSync(histPath, "utf8");
        const history = JSON.parse(raw) as TradeThesis[];
        this.historyStore.set(thesisId, history);
        return history;
      }
    } catch {
      // Fallback
    }

    const single = await this.getThesis(thesisId);
    return single ? [single] : [];
  }

  /**
   * Clears memory cache (useful for testing persistence reload from disk).
   */
  clearMemoryCache(): void {
    this.memoryStore.clear();
    this.historyStore.clear();
  }
}

export const defaultThesisStore = new DurableTradeThesisStore();
