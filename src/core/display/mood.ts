// Moods and the moment-to-moment state of a face (shared by faces and animations).

export const MOODS = ["neutral", "happy", "sad", "angry", "sleepy", "surprised"] as const;
export type Mood = (typeof MOODS)[number];

export interface FaceState {
  mood: Mood;
  /** 0 = open, 1 = closed. */
  blink: number;
  /** Where the eyes look, -1 … 1 (left/up to right/down). */
  lookX: number;
  lookY: number;
  /** 0 = mouth closed, 1 = wide open (talking). */
  talk: number;
}

export const NEUTRAL: FaceState = { mood: "neutral", blink: 0, lookX: 0, lookY: 0, talk: 0 };

