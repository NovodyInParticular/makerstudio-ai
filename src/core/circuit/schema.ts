// Circuit data as saved in the project file (zod only).

import { z } from "zod";

export const CircuitComponentSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1).max(60),
  label: z.string().min(1).max(60),
  /** Position on the canvas, in 0.1 inch grid steps. */
  x: z.number().finite(),
  y: z.number().finite(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  props: z.record(z.string(), z.union([z.number().finite(), z.string().max(60), z.boolean()])),
});
export type CircuitComponent = z.infer<typeof CircuitComponentSchema>;

export const PinRefSchema = z.object({ component: z.string().min(1), pin: z.string().min(1).max(20) });
export type PinRef = z.infer<typeof PinRefSchema>;

export const WireSchema = z.object({
  id: z.string().min(1),
  from: PinRefSchema,
  to: PinRefSchema,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
export type Wire = z.infer<typeof WireSchema>;
