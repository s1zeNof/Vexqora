import type { ExecutionGateParams } from "./ensemble-gate";
import type { SignalExecutionEvidence } from "./ai-copilot";

export interface SignalEnvelope {
  executionEvidence?: SignalExecutionEvidence;
  opportunity?: { executionEvidence?: SignalExecutionEvidence };
  metadata?: SignalExecutionEvidence;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function extractSignalExecutionEvidence(value: unknown): SignalExecutionEvidence | null {
  if (!isRecord(value)) return null;

  const direct = value.executionEvidence;
  if (isRecord(direct) && direct.version === 1) return direct as unknown as SignalExecutionEvidence;

  const opportunity = value.opportunity;
  if (isRecord(opportunity)) {
    const nested = opportunity.executionEvidence;
    if (isRecord(nested) && nested.version === 1) return nested as unknown as SignalExecutionEvidence;
  }

  const metadata = value.metadata;
  if (isRecord(metadata) && metadata.version === 1) return metadata as unknown as SignalExecutionEvidence;
  return null;
}

export function toExecutionGateEvidence(
  value: unknown,
  nowMs = Date.now()
): Partial<ExecutionGateParams> {
  const evidence = extractSignalExecutionEvidence(value);
  if (!evidence) return {};

  if (evidence.expiresAtMs <= nowMs) {
    const reason = `Signal evidence expired at ${new Date(evidence.expiresAtMs).toISOString()}; fresh analysis is required.`;
    return {
      structureEvidence: { status: "UNKNOWN", reason, source: "EvidenceTTL", dataAsOfMs: evidence.expiresAtMs },
      mlEvidence: { status: "UNKNOWN", reason, source: "EvidenceTTL", dataAsOfMs: evidence.expiresAtMs },
      newsEvidence: { status: "UNKNOWN", reason, source: "EvidenceTTL", dataAsOfMs: evidence.expiresAtMs },
      mlDecision: "UNKNOWN",
      newsStatus: "STALE"
    };
  }

  return {
    structureTrend: evidence.structureTrend,
    structureEvidence: evidence.structureEvidence,
    mlDecision: evidence.mlDecision,
    mlEvidence: evidence.mlEvidence,
    winProbabilityPct: evidence.winProbabilityPct,
    evUsd: evidence.evUsd ?? undefined,
    hasCriticalNews: evidence.hasCriticalNews ?? undefined,
    newsStatus: evidence.newsStatus,
    newsEvidence: evidence.newsEvidence
  };
}
