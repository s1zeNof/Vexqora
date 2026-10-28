import { describe, it, expect } from "vitest";
import {
  extractTokenFromPrompt,
  extractBudgetFromPrompt,
  calculateCopilotScenarios,
  type CopilotMarketData
} from "./copilot-analyst";
import { parseSignalText } from "./parser";

describe("Copilot Analyst Engine", () => {
  describe("extractTokenFromPrompt", () => {
    it("extracts token from typical Ukrainian prompt with 'монету SOL'", () => {
      const q = "Маю 15$ але хочу увійти в монету SOL проаналізуй різні випадку входу та TP/SL";
      expect(extractTokenFromPrompt(q)).toBe("SOLUSDT");
    });

    it("extracts token from Cyrillic names like 'біткоїн' and 'ефір'", () => {
      expect(extractTokenFromPrompt("Чи варто купувати біткоїн зараз?")).toBe("BTCUSDT");
      expect(extractTokenFromPrompt("Аналіз по ефіру")).toBe("ETHUSDT");
      expect(extractTokenFromPrompt("солана дає точку входу?")).toBe("SOLUSDT");
    });

    it("extracts explicit TICKERUSDT", () => {
      expect(extractTokenFromPrompt("Подивись DOGEUSDT на 15хв")).toBe("DOGEUSDT");
    });

    it("extracts standalone uppercase token", () => {
      expect(extractTokenFromPrompt("Що думаєш про SUI на сьогодні?")).toBe("SUIUSDT");
    });

    it("falls back to BTCUSDT when no token is present", () => {
      expect(extractTokenFromPrompt("Яка зараз ситуація на ринку?")).toBe("BTCUSDT");
    });
  });

  describe("extractBudgetFromPrompt", () => {
    it("extracts budget with dollar sign or symbol", () => {
      expect(extractBudgetFromPrompt("Маю 15$ але хочу увійти в монету SOL")).toBe(15);
      expect(extractBudgetFromPrompt("Депозит $25.50 для скальпінгу")).toBe(25.5);
      expect(extractBudgetFromPrompt("хочу зайти на 9.37 usdt")).toBe(9.37);
      expect(extractBudgetFromPrompt("бюджет 100 бакс")).toBe(100);
    });

    it("falls back to user balance when prompt does not state a budget", () => {
      expect(extractBudgetFromPrompt("Проаналізуй SOL будь ласка", 9.37)).toBe(9.37);
      expect(extractBudgetFromPrompt("Куди піде біткоїн?", 45.20)).toBe(45.2);
    });
  });

  describe("calculateCopilotScenarios", () => {
    const mockMarket: CopilotMarketData = {
      symbol: "SOLUSDT",
      currentPrice: 175.5,
      price24hPcnt: 3.2,
      high24h: 180.0,
      low24h: 170.0,
      volume24hUsd: 500000000,
      fundingRatePct: 0.01,
      orderBookImbalancePct: 15.2,
      buyerAggressionPct: 57.6,
      trend15m: "bullish",
      rsi15m: 56
    };

    it("produces 3 distinct scenarios tailored to user's exact balance", () => {
      const budget = 15;
      const { scenarios, bestScenarioId } = calculateCopilotScenarios(mockMarket, budget, "Маю 15$ але хочу увійти в монету SOL");

      expect(scenarios).toHaveLength(3);
      expect(["conservative", "momentum", "deep_swing"]).toContain(bestScenarioId);

      const conservative = scenarios.find((s) => s.id === "conservative")!;
      const momentum = scenarios.find((s) => s.id === "momentum")!;
      const swing = scenarios.find((s) => s.id === "deep_swing")!;
      expect(swing.leverage).toBe(3);

      // Verify conservative properties
      expect(conservative.orderType).toBe("Limit");
      expect(conservative.entryPrice).toBeLessThan(mockMarket.currentPrice);
      expect(conservative.stopLoss).toBeLessThan(conservative.entryPrice);
      expect(conservative.tp1).toBeGreaterThan(conservative.entryPrice);
      expect(conservative.allocatedMarginUsdt).toBe(15);
      expect(conservative.maxLossUsdt).toBeLessThan(budget); // strictly bounded risk!
      expect(conservative.targetGainUsdt).toBeGreaterThan(0);
      expect(conservative.riskRewardRatio).toBeGreaterThan(2);

      // Verify momentum properties
      expect(momentum.orderType).toBe("Market");
      expect(momentum.entryPrice).toBe(mockMarket.currentPrice);
      expect(momentum.stopLoss).toBeLessThan(momentum.entryPrice);

      // Verify all rawSignalText can be parsed by parseSignalText without errors
      for (const sc of scenarios) {
        const parsed = parseSignalText(sc.rawSignalText, "api");
        expect(parsed.symbol).toBe("SOLUSDT");
        expect(parsed.side).toBe("long");
        expect(parsed.stopLoss).toBe(sc.stopLoss);
        expect(parsed.takeProfits.length).toBeGreaterThanOrEqual(1);
      }
    });

    it("respects user's explicit short intention", () => {
      const budget = 9.37;
      const { scenarios } = calculateCopilotScenarios(mockMarket, budget, "Хочу відкрити шорт по SOL на 9.37$");

      for (const sc of scenarios) {
        expect(sc.side).toBe("short");
        expect(sc.stopLoss).toBeGreaterThan(sc.entryPrice);
        expect(sc.tp1).toBeLessThan(sc.entryPrice);
      }
    });
  });
});
