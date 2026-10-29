import { z } from "zod";
import { BASKETBALL_DEFAULTS } from "./sports/basketball";

/** Configurable per tournament. Nothing here is hardcoded into the engine. */
export const rulesetSchema = z.object({
  periodCount: z.number().int().min(1).max(8).default(BASKETBALL_DEFAULTS.periodCount),
  periodSeconds: z.number().int().min(30).max(1800).default(BASKETBALL_DEFAULTS.periodSeconds),
  overtimeSeconds: z.number().int().min(30).max(900).default(BASKETBALL_DEFAULTS.overtimeSeconds),
  maxPersonalFouls: z.number().int().min(1).max(10).default(BASKETBALL_DEFAULTS.maxPersonalFouls),
  maxTimeouts: z.number().int().min(0).max(12).default(BASKETBALL_DEFAULTS.maxTimeouts),
  standingPoints: z
    .object({
      win: z.number().int().min(0).max(5).default(2),
      loss: z.number().int().min(0).max(5).default(1),
      forfeit: z.number().int().min(0).max(5).default(0),
    })
    .default({ win: 2, loss: 1, forfeit: 0 }),
  allowDraws: z.boolean().default(false),
});

export type Ruleset = z.infer<typeof rulesetSchema>;

export const DEFAULT_RULESET: Ruleset = rulesetSchema.parse({});

export function parseRuleset(raw: unknown): Ruleset {
  return rulesetSchema.parse(raw ?? {});
}

export function parseRulesetJson(raw: string | null | undefined): Ruleset {
  if (!raw) return DEFAULT_RULESET;
  try {
    return rulesetSchema.parse(JSON.parse(raw));
  } catch {
    return DEFAULT_RULESET;
  }
}
