import { z } from "zod";

export const signalSchema = z.object({
  symbol: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{5,20}$/),
  side: z.enum(["long", "short"]),
  entry: z.discriminatedUnion("type", [
    z.object({ type: z.literal("market") }),
    z.object({ type: z.literal("limit"), price: z.number().positive() }),
    z.object({
      type: z.literal("range"),
      from: z.number().positive(),
      to: z.number().positive()
    }).refine(({ from, to }) => from <= to, "Entry range must be ascending")
  ]),
  stopLoss: z.number().positive(),
  takeProfits: z.array(z.object({
    price: z.number().positive(),
    sharePct: z.number().positive().max(100)
  })).min(1).refine(
    (targets) => Math.abs(targets.reduce((sum, target) => sum + target.sharePct, 0) - 100) < 0.0001,
    "Take-profit shares must total 100%"
  ),
  trailingStop: z.object({
    activationPrice: z.number().positive().optional(),
    distance: z.object({
      type: z.enum(["percent", "absolute"]),
      value: z.number().positive()
    })
  }).optional(),
  leverage: z.number().int().positive().optional(),
  riskPct: z.number().positive().max(100).optional(),
  source: z.enum(["chat", "telegram", "tradingview", "api"]),
  note: z.string().max(1000).optional()
});

export type Signal = z.infer<typeof signalSchema>;

