import { invalid } from "../errors";
import { basketballAdapter } from "./basketball";
import type { SportAdapter } from "./types";

const ADAPTERS = new Map<string, SportAdapter>([[basketballAdapter.key, basketballAdapter]]);

export const SPORT_KEYS = [...ADAPTERS.keys()];

export function getSportAdapter(key: string): SportAdapter {
  const adapter = ADAPTERS.get(key);
  if (!adapter) {
    throw invalid(`Unsupported sport "${key}". Available: ${SPORT_KEYS.join(", ")}.`);
  }
  return adapter;
}

export function listSports(): { key: string; name: string }[] {
  return [...ADAPTERS.values()].map(({ key, name }) => ({ key, name }));
}
