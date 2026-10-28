/**
 * ML Model Registry & Artifact Health Gate (P0-11)
 *
 * Verifies live model availability, artifact provenance, weights hash,
 * out-of-sample metrics, and calibration status.
 *
 * Rule: Zero synthetic performance claims. If model artifact or weights
 * are unverified/unavailable, returns MODEL_UNAVAILABLE with null win probability.
 */

export interface MLModelArtifact {
  modelId: string;
  version: string;
  algorithm: "CatBoostClassifier" | "RuleHeuristic";
  weightsHash: string | null;
  trainedAt: string | null;
  datasetRange: string | null;
  symbols: string[];
  featuresUsed: string[];
  outOfSampleBrierScore: number | null;
  outOfSampleAccuracy: number | null;
  calibrationStatus: "CALIBRATED" | "UNCALIBRATED" | "EXPERIMENTAL";
  status: "ONLINE" | "MODEL_UNAVAILABLE";
}

export interface ModelHealthReport {
  status: "HEALTHY" | "DEGRADED" | "UNAVAILABLE";
  activeModelId: string | null;
  activeModelVersion: string | null;
  isCalibrated: boolean;
  weightsLoaded: boolean;
  checkedAtMs: number;
  models: MLModelArtifact[];
}

export const REGISTERED_MODELS: MLModelArtifact[] = [
  {
    modelId: "catboost-btc-15m-v1",
    version: "1.0.0-rc",
    algorithm: "CatBoostClassifier",
    weightsHash: null, // Production .cbm binary weights hash
    trainedAt: null,
    datasetRange: null,
    symbols: ["BTCUSDT", "ETHUSDT"],
    featuresUsed: [
      "rsi_14",
      "atr_14",
      "vol_surge",
      "cvd_delta",
      "obi_imbalance",
      "adx_14",
      "bb_width"
    ],
    outOfSampleBrierScore: null,
    outOfSampleAccuracy: null,
    calibrationStatus: "UNCALIBRATED",
    status: "MODEL_UNAVAILABLE"
  }
];

/**
 * Checks model availability and calibration health.
 */
export function getModelRegistryHealth(activeModelId?: string): ModelHealthReport {
  const modelId = activeModelId ?? "catboost-btc-15m-v1";
  const model = REGISTERED_MODELS.find(m => m.modelId === modelId);

  if (!model || model.weightsHash === null || model.calibrationStatus !== "CALIBRATED") {
    return {
      status: "UNAVAILABLE",
      activeModelId: model?.modelId ?? null,
      activeModelVersion: model?.version ?? null,
      isCalibrated: false,
      weightsLoaded: Boolean(model?.weightsHash),
      checkedAtMs: Date.now(),
      models: REGISTERED_MODELS
    };
  }

  return {
    status: "HEALTHY",
    activeModelId: model.modelId,
    activeModelVersion: model.version,
    isCalibrated: true,
    weightsLoaded: true,
    checkedAtMs: Date.now(),
    models: REGISTERED_MODELS
  };
}
