// Real part markings, so the drawings match what is printed on the part in your hand.

export const BAND_COLORS = ["#1a1a1a", "#7a4a1e", "#d0312d", "#f08a1c", "#f2d21b", "#2e9e45", "#2f6fd6", "#8a4fcf", "#8d8d8d", "#f4f4f4"] as const;
export const BAND_NAMES = ["black", "brown", "red", "orange", "yellow", "green", "blue", "violet", "grey", "white"] as const;
const GOLD = "#c9a227", SILVER = "#c0c6cc";

/** 4-band resistor code (2 digits, multiplier, ±5 % gold): e.g. 220 Ω = red red brown gold. */
export function resistorBands(ohms: number): { colors: string[]; names: string[] } {
  if (!(ohms > 0) || !Number.isFinite(ohms)) return { colors: [], names: [] };
  let exp = Math.floor(Math.log10(ohms)) - 1;
  let digits = Math.round(ohms / 10 ** exp);
  if (digits >= 100) { digits = Math.round(digits / 10); exp += 1; }
  const d1 = Math.floor(digits / 10), d2 = digits % 10;
  const mult = exp >= 0 && exp <= 9 ? { c: BAND_COLORS[exp]!, n: BAND_NAMES[exp]! } : exp === -1 ? { c: GOLD, n: "gold" } : exp === -2 ? { c: SILVER, n: "silver" } : null;
  if (!mult || d1 === 0) return { colors: [], names: [] };
  return { colors: [BAND_COLORS[d1]!, BAND_COLORS[d2]!, mult.c, GOLD], names: [BAND_NAMES[d1]!, BAND_NAMES[d2]!, mult.n, "gold"] };
}

/** 3-digit ceramic capacitor code in pF: 0.1 µF = "104", 22 pF = "22". */
export function capacitorCode(microfarads: number): string {
  const pf = Math.round(microfarads * 1e6);
  if (pf < 100) return String(pf);
  const exp = Math.floor(Math.log10(pf)) - 1;
  const digits = Math.round(pf / 10 ** exp);
  return digits >= 100 ? `${Math.floor(digits / 10)}${exp + 1}` : `${digits}${exp}`;
}
