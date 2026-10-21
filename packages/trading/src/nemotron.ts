import type { AISignalOpportunity, EnhancedSignalResult } from "./ai-copilot";
import { generateOpportunityFromTicker } from "./ai-copilot";
import { findHistoricalPatternMatch, type HistoricalPatternMatch } from "./memory";
import { parseSignalText } from "./parser";
import { roundToStep } from "./risk";

export interface NemotronResponse {
  content: string;
  reasoning?: string;
}

const DEFAULT_MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free";

export async function callNemotron(
  messages: Array<{ role: string; content: string }>,
  options?: {
    apiKey?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
  }
): Promise<NemotronResponse> {
  const apiKey = options?.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }

  const model = options?.model ?? process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL;

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://vexqora.vercel.app",
      "X-Title": "Vexqora Trade"
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: options?.temperature ?? 0.5,
      max_tokens: options?.maxTokens ?? 700
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Nemotron API error ${response.status}: ${errorText}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
        reasoning?: string;
      };
    }>;
  };

  const choice = data.choices?.[0]?.message;
  return {
    content: choice?.content?.trim() ?? "",
    ...(choice?.reasoning ? { reasoning: choice.reasoning.trim() } : {})
  };
}

interface NemotronParsedJSON {
  symbol: string;
  side: "long" | "short";
  strategy: string;
  reasoning: string;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  qualityScore: number;
  winProbabilityPct: number;
}

function extractJSON(text: string): NemotronParsedJSON | null {
  try {
    // Clean potential markdown blocks
    let clean = text.trim();
    if (clean.startsWith("```json")) {
      clean = clean.slice(7);
    } else if (clean.startsWith("```")) {
      clean = clean.slice(3);
    }
    if (clean.endsWith("```")) {
      clean = clean.slice(0, -3);
    }
    const start = clean.indexOf("{");
    const end = clean.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      clean = clean.slice(start, end + 1);
    }
    return JSON.parse(clean) as NemotronParsedJSON;
  } catch {
    return null;
  }
}

export async function generateNemotronOpportunity(
  symbol: string,
  currentPrice: number,
  options?: {
    tickSize?: number;
    riskPct?: number;
    leverage?: number;
    historicalContext?: HistoricalPatternMatch;
  }
): Promise<AISignalOpportunity> {
  const normSymbol = symbol.toUpperCase();
  const tickSize = options?.tickSize ?? 0.1;
  const hist = options?.historicalContext ?? findHistoricalPatternMatch(normSymbol, "liquidity_sweep", 2.5);

  try {
    const res = await callNemotron([
      {
        role: "system",
        content: `You are Vexqora AI Copilot powered by Nvidia Nemotron 3 Ultra 550B, an institutional cryptocurrency futures trader.
Vexqora Memory Historical Context: Pattern matches "${hist.patternName}" (${hist.marketRegime}). Historical Sample Count: ${hist.sampleCount} episodes, ${hist.winRatePct}% historical win rate. ${hist.historicalContext}
Analyze the requested asset with this historical edge in mind and output ONLY valid JSON matching this exact structure:
{
  "symbol": "${normSymbol}",
  "side": "long" or "short",
  "strategy": "concise institutional strategy name (e.g. ${hist.patternName})",
  "reasoning": "2-3 sentences of deep quantitative and structural reasoning for this trade",
  "stopLoss": number,
  "tp1": number,
  "tp2": number,
  "tp3": number,
  "qualityScore": number between 8.0 and 9.9,
  "winProbabilityPct": number between 65 and 78
}
Rules:
- For 'long', stopLoss MUST be < current price, and tp1 < tp2 < tp3 MUST be > current price.
- For 'short', stopLoss MUST be > current price, and tp1 > tp2 > tp3 MUST be < current price.
- Return pure JSON only. Do not add markdown or conversational preambles.`
      },
      {
        role: "user",
        content: `Asset: ${normSymbol}, Live Bybit Price: ${currentPrice} USDT. Historical analog win-rate is ${hist.winRatePct}%. Formulate the highest probability setup.`
      }
    ]);

    const parsedJSON = extractJSON(res.content);
    if (parsedJSON && parsedJSON.stopLoss && parsedJSON.tp1) {
      const side = parsedJSON.side === "short" ? "short" : "long";
      const sl = roundToStep(parsedJSON.stopLoss, tickSize);
      const tp1 = roundToStep(parsedJSON.tp1, tickSize);
      const tp2 = roundToStep(parsedJSON.tp2, tickSize);
      const tp3 = roundToStep(parsedJSON.tp3, tickSize);

      // Validate sanity of SL and TP direction
      const isValidLong = side === "long" && sl < currentPrice && tp1 > currentPrice;
      const isValidShort = side === "short" && sl > currentPrice && tp1 < currentPrice;

      if (isValidLong || isValidShort) {
        const lev = options?.leverage ?? 5;
        const risk = options?.riskPct ?? 1;

        const rawSignal = `${normSymbol} ${side.toUpperCase()}
entry market
tp ${tp1} 40%, ${tp2} 35%, ${tp3} 25%
sl ${sl}
trail 1% after tp1
lev ${lev}
risk ${risk}%`;

        const parsedSignal = parseSignalText(rawSignal, "chat");
        const slDist = Math.abs(currentPrice - sl);
        const tpAvg = Math.abs((tp1 * 0.4 + tp2 * 0.35 + tp3 * 0.25) - currentPrice);
        const rr = Number((tpAvg / slDist).toFixed(2));

        const score = typeof parsedJSON.qualityScore === "number"
          ? (parsedJSON.qualityScore > 10 ? parsedJSON.qualityScore / 10 : parsedJSON.qualityScore)
          : 9.3;

        return {
          symbol: normSymbol,
          side,
          currentPrice,
          qualityScore: Number(score.toFixed(1)),
          qualityTier: score >= 9.2 ? "A+" : "A",
          strategy: `${parsedJSON.strategy || "Nemotron Institutional Setup"} (Nemotron 3 Ultra)`,
          rationale: parsedJSON.reasoning || "Nemotron multi-timeframe order flow analysis indicates high probability institutional continuation.",
          riskReward: rr,
          winProbabilityPct: parsedJSON.winProbabilityPct || 70,
          rawSignal,
          parsedSignal,
          entryPrice: currentPrice,
          stopLoss: sl,
          takeProfits: [
            { price: tp1, sharePct: 40 },
            { price: tp2, sharePct: 35 },
            { price: tp3, sharePct: 25 }
          ],
          trailingDistancePct: 1,
          suggestedLeverage: lev,
          historicalMatch: hist
        };
      }
    }
  } catch (err) {
    // If Nemotron call fails or rate limits, fallback gracefully to algorithmic engine
    console.warn("Nemotron call failed, falling back to algorithmic quant engine:", err);
  }

  // Graceful fallback
  return generateOpportunityFromTicker(normSymbol, currentPrice, options);
}

export async function enhanceNemotronSignal(
  rawSignal: string,
  currentPrice: number,
  tickSize: number = 0.1
): Promise<EnhancedSignalResult> {
  try {
    const res = await callNemotron([
      {
        role: "system",
        content: `You are Nvidia Nemotron 3 Ultra 550B, an AI trade optimization agent.
Given a cryptocurrency futures signal and current market price, optimize the Stop Loss to an institutional structural invalidation point and optimize the Take Profit ladder for superior risk/reward.
Return ONLY JSON:
{
  "optimizedStopLoss": number,
  "tp1": number,
  "tp2": number,
  "tp3": number,
  "improvements": ["bullet 1 explaining adjustment", "bullet 2 explaining why risk is reduced"],
  "summary": "1 sentence summarizing the enhancement"
}`
      },
      {
        role: "user",
        content: `Signal: ${rawSignal}\nCurrent Price: ${currentPrice}`
      }
    ]);

    const json = extractJSON(res.content) as {
      optimizedStopLoss?: number;
      tp1?: number;
      tp2?: number;
      tp3?: number;
      improvements?: string[];
      summary?: string;
    } | null;

    if (json?.optimizedStopLoss && json.tp1) {
      const orig = parseSignalText(rawSignal, "chat");
      const sl = roundToStep(json.optimizedStopLoss, tickSize);
      const tp1 = roundToStep(json.tp1, tickSize);
      const tp2 = roundToStep(json.tp2 ?? tp1 * 1.02, tickSize);
      const tp3 = roundToStep(json.tp3 ?? tp2 * 1.03, tickSize);

      const enhancedText = `${orig.symbol} ${orig.side.toUpperCase()}
entry ${orig.entry.type === "limit" ? orig.entry.price : "market"}
tp ${tp1} 40%, ${tp2} 35%, ${tp3} 25%
sl ${sl}
trail 1% after tp1
lev ${orig.leverage ?? 5}
risk ${orig.riskPct ?? 1}%`;

      const parsedSignal = parseSignalText(enhancedText, "chat");

      return {
        rawText: enhancedText,
        parsedSignal,
        improvements: json.improvements ?? ["Nvidia Nemotron 3 Ultra tightened Stop Loss and balanced Take Profit scale."],
        summary: json.summary ?? `Nemotron 3 Ultra calibrated ${orig.symbol} setup for institutional expectancy.`
      };
    }
  } catch (err) {
    console.warn("Nemotron enhancement failed, falling back to algorithmic enhancement:", err);
  }

  // Fallback to local algorithmic enhancement
  const { enhanceSignal } = await import("./ai-copilot");
  return enhanceSignal(rawSignal, currentPrice, tickSize);
}
