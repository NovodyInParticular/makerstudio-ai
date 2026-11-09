// MakerStudio AI face engine (generated projects include this file unchanged).
//
// Draws a robot face and plays face animations. It is a line-by-line port of MakerStudio's
// preview code (src/core/display/face.ts and animation.ts), and it draws every shape from
// horizontal lines only, so the robot shows the same pixels as the preview in the app.
// (On 8-bit AVR boards such as the Uno, "double" is 32-bit, so in rare cases an edge
// pixel can differ.)
//
// License: MIT. Copy and change it freely in your own projects.

#pragma once
#include <math.h>
#include <stdint.h>
#include <string.h>

// On 8-bit AVR boards (Uno, Nano) keyframes are kept in flash memory to save RAM.
#if defined(__AVR__)
#include <avr/pgmspace.h>
#define FE_PROGMEM PROGMEM
static inline void fe_loadKey(const void* src, void* dst, size_t n) { memcpy_P(dst, src, n); }
#else
#define FE_PROGMEM
static inline void fe_loadKey(const void* src, void* dst, size_t n) { memcpy(dst, src, n); }
#endif

typedef double fe_real;

enum FeEyeShape : uint8_t { FE_EYE_ROUND = 0, FE_EYE_ROUNDED = 1, FE_EYE_RECT = 2 };
enum FeMouth : uint8_t { FE_MOUTH_NONE = 0, FE_MOUTH_LINE = 1, FE_MOUTH_SMILE = 2, FE_MOUTH_OPEN = 3, FE_MOUTH_FROWN = 4 };
enum FeMood : uint8_t { FE_NEUTRAL = 0, FE_HAPPY = 1, FE_SAD = 2, FE_ANGRY = 3, FE_SLEEPY = 4, FE_SURPRISED = 5 };

struct FeFace {
  uint8_t eyeShape;
  fe_real eyeWidth, eyeHeight, eyeRound, eyeSpacing, eyeY, pupil;
  uint8_t mouth;
  fe_real mouthWidth, mouthY, mouthThickness;
  uint32_t background, foreground; // 0xRRGGBB
  bool hasCheeks;
  uint32_t cheeks;
};

struct FeState {
  uint8_t mood;
  fe_real blink, lookX, lookY, talk;
};

// Which channels a keyframe sets.
enum : uint8_t { FE_K_MOOD = 1, FE_K_LOOKX = 2, FE_K_LOOKY = 4, FE_K_BLINK = 8, FE_K_TALK = 16 };

struct FeKey {
  uint32_t t; // ms
  uint8_t has;
  uint8_t mood;
  fe_real lookX, lookY, blink, talk;
};

struct FeAnimation {
  uint32_t duration; // ms
  bool loop;
  const FeKey* keys; // sorted by time
  uint16_t count;
};

// --- helpers matching JavaScript's Math.round and friends ---------------------------------

static inline int fe_round(fe_real x) { return (int)floor(x + 0.5); }
static inline fe_real fe_clamp(fe_real v, fe_real lo, fe_real hi) { return v < lo ? lo : (v > hi ? hi : v); }
static inline int fe_imax(int a, int b) { return a > b ? a : b; }
static inline int fe_imin(int a, int b) { return a < b ? a : b; }

// --- drawing primitives built from horizontal lines -----------------------------------------
// HLine is any function or lambda: void hline(int x0, int x1, int y, uint32_t rgb)
// It is only called with lines already clipped to the screen.

template <class HLine>
struct FeCanvas {
  int W, H;
  HLine& hline;
  void span(int y, int x0, int x1, uint32_t c) {
    if (y < 0 || y >= H) return;
    int a = fe_imax(0, x0), b = fe_imin(W - 1, x1);
    if (a <= b) hline(a, b, y, c);
  }
  void fill(uint32_t c) { for (int y = 0; y < H; y++) span(y, 0, W - 1, c); }
  void rect(int x, int y, int w, int h, uint32_t c) { for (int yy = y; yy < y + h; yy++) span(yy, x, x + w - 1, c); }
  void ellipse(int cx, int cy, int rx, int ry, uint32_t c) {
    fe_real ax = rx + 0.5, ay = ry + 0.5;
    for (int dy = -ry; dy <= ry; dy++) {
      fe_real q = 1.0 - (fe_real)(dy * dy) / (ay * ay);
      int half = (int)floor(ax * sqrt(q > 0 ? q : 0) + 1e-9);
      int h = fe_imin(half, rx);
      span(cy + dy, cx - h, cx + h, c);
    }
  }
  void roundRect(int x, int y, int w, int h, int r, uint32_t c) {
    int rr = r; int lim = (int)floor((fe_real)fe_imin(w, h) / 2.0);
    if (rr > lim) rr = lim;
    if (rr < 0) rr = 0;
    for (int yy = y; yy < y + h; yy++) {
      fe_real dy = yy < y + rr ? (fe_real)(y + rr - yy) - 0.5 : (yy > y + h - 1 - rr ? (fe_real)(yy - (y + h - 1 - rr)) - 0.5 : 0);
      int inset = 0;
      if (dy > 0) {
        fe_real q = (fe_real)rr * rr - dy * dy;
        inset = (int)ceil((fe_real)rr - sqrt(q > 0 ? q : 0) - 0.5);
        if (inset < 0) inset = 0;
      }
      span(yy, x + inset, x + w - 1 - inset, c);
    }
  }
  void triangle(int x0, int y0, int x1, int y1, int x2, int y2, uint32_t c) {
    int px[3] = {x0, x1, x2}, py[3] = {y0, y1, y2};
    int ymin = fe_imin(y0, fe_imin(y1, y2)), ymax = fe_imax(y0, fe_imax(y1, y2));
    for (int y = ymin; y <= ymax; y++) {
      bool any = false; fe_real lo = 0, hi = 0;
      for (int i = 0; i < 3; i++) {
        int ax = px[i], ay = py[i], bx = px[(i + 1) % 3], by = py[(i + 1) % 3];
        fe_real xs[2]; int n = 0;
        if (ay == by) { if (y == ay) { xs[0] = ax; xs[1] = bx; n = 2; } }
        else if (y >= fe_imin(ay, by) && y <= fe_imax(ay, by)) { xs[0] = ax + (fe_real)(y - ay) * (bx - ax) / (fe_real)(by - ay); n = 1; }
        for (int k = 0; k < n; k++) {
          if (!any) { lo = hi = xs[k]; any = true; }
          else { if (xs[k] < lo) lo = xs[k]; if (xs[k] > hi) hi = xs[k]; }
        }
      }
      if (any) span(y, fe_round(lo), fe_round(hi), c);
    }
  }
};

// --- the face ------------------------------------------------------------------------------

template <class HLine>
void feDrawFace(const FeFace& f, int W, int H, bool mono, const FeState& s, HLine hline) {
  FeCanvas<HLine> g{W, H, hline};
  uint32_t bg = mono ? 0x000000 : f.background;
  uint32_t fg = mono ? 0xFFFFFF : f.foreground;
  g.fill(bg);

  fe_real blink = fe_clamp(s.blink, 0, 1);
  fe_real lookX = fe_clamp(s.lookX, -1, 1), lookY = fe_clamp(s.lookY, -1, 1);
  fe_real grow = s.mood == FE_SURPRISED ? 1.18 : 1.0;
  int ew = fe_imax(2, fe_round(f.eyeWidth * W * grow));
  int fullH = fe_imax(2, fe_round(f.eyeHeight * H * grow));
  int eh = fe_imax(1, fe_round(fullH * (1 - 0.9 * blink)));
  int shiftX = fe_round(lookX * W * 0.06), shiftY = fe_round(lookY * H * 0.06);
  int cy = fe_round(f.eyeY * H) + shiftY;

  for (int side = -1; side <= 1; side += 2) {
    int cx = fe_round(W / 2.0 + (side * f.eyeSpacing * W) / 2.0) + shiftX;
    int x = cx - fe_round(ew / 2.0), y = cy - fe_round(eh / 2.0);
    if (f.eyeShape == FE_EYE_ROUND) g.ellipse(cx, cy, fe_imax(1, fe_round(ew / 2.0)), fe_imax(1, fe_round(eh / 2.0)), fg);
    else if (f.eyeShape == FE_EYE_RECT) g.rect(x, y, ew, eh, fg);
    else g.roundRect(x, y, ew, eh, fe_round((fe_imin(ew, eh) / 2.0) * f.eyeRound), fg);

    if (f.pupil > 0 && blink < 0.6) {
      int pr = fe_imax(1, fe_round((fe_imin(ew, eh) * f.pupil) / 2.0));
      int px = cx + fe_round(lookX * (ew / 2.0 - pr) * 0.8), py = cy + fe_round(lookY * (eh / 2.0 - pr) * 0.8);
      g.ellipse(px, py, pr, pr, bg);
    }

    int top = cy - fe_round(eh / 2.0) - 1, bottom = cy + fe_round(eh / 2.0) + 1;
    int left = cx - fe_round(ew / 2.0) - 1, right = cx + fe_round(ew / 2.0) + 1;
    int inner = side < 0 ? right : left, outer = side < 0 ? left : right;
    if (s.mood == FE_SLEEPY) g.rect(left, top, right - left + 1, fe_round(eh * 0.5) + 1, bg);
    else if (s.mood == FE_ANGRY) g.triangle(outer, top, inner, top, inner, top + fe_round(eh * 0.55), bg);
    else if (s.mood == FE_SAD) g.triangle(inner, top, outer, top, outer, top + fe_round(eh * 0.5), bg);
    else if (s.mood == FE_HAPPY) g.ellipse(cx, bottom + fe_round(eh * 0.15), fe_round(ew * 0.62), fe_round(eh * 0.6), bg);
  }

  if (!mono && f.hasCheeks && s.mood != FE_ANGRY) {
    int r = fe_imax(2, fe_round(H * 0.04));
    for (int side = -1; side <= 1; side += 2) {
      int cx = fe_round(W / 2.0 + (side * f.eyeSpacing * W) / 2.0 + side * f.eyeWidth * W * 0.5) + shiftX;
      g.ellipse(cx, cy + fe_round(f.eyeHeight * H * 0.85), fe_round(r * 1.6), r, f.cheeks);
    }
  }

  if (f.mouth != FE_MOUTH_NONE) {
    int mw = fe_imax(2, fe_round(f.mouthWidth * W));
    int t = fe_imax(1, fe_round(f.mouthThickness * H));
    int mx = fe_round(W / 2.0) + fe_round(shiftX / 2.0), my = fe_round(f.mouthY * H);
    uint8_t kind = f.mouth;
    if (s.mood == FE_HAPPY) kind = FE_MOUTH_SMILE;
    else if (s.mood == FE_SAD) kind = FE_MOUTH_FROWN;
    else if (s.mood == FE_SURPRISED) kind = FE_MOUTH_OPEN;
    fe_real talk = fe_clamp(s.talk, 0, 1);
    if (talk > 0.05 && kind != FE_MOUTH_OPEN) kind = FE_MOUTH_OPEN;

    if (kind == FE_MOUTH_LINE) {
      g.roundRect(mx - fe_round(mw / 2.0), my - fe_round(t / 2.0), mw, t, fe_round(t / 2.0), fg);
    } else if (kind == FE_MOUTH_OPEN) {
      fe_real open = s.mood == FE_SURPRISED ? (talk > 0.6 ? talk : 0.6) : talk;
      int rx = s.mood == FE_SURPRISED ? fe_imax(2, fe_round(mw * 0.22)) : fe_imax(2, fe_round(mw / 2.0));
      int ry = fe_imax(1, fe_round(t / 2.0 + open * H * 0.07));
      g.ellipse(mx, my, rx, ry, fg);
    } else {
      int rx = fe_round(mw / 2.0), ry = fe_imax(t + 1, fe_round(H * 0.06));
      int down = kind == FE_MOUTH_SMILE ? 1 : -1;
      g.ellipse(mx, my, rx, ry, fg);
      g.ellipse(mx, my - down * t, fe_imax(1, rx - t), ry, bg);
      if (down > 0) g.rect(mx - rx - 1, my - ry - t - 1, 2 * rx + 3, ry + t + 1, bg);
      else g.rect(mx - rx - 1, my + 1, 2 * rx + 3, ry + t + 2, bg);
    }
  }
}

// --- animations ----------------------------------------------------------------------------

static inline fe_real fe_ease(fe_real x) { return x * x * (3 - 2 * x); }

static fe_real fe_keyValue(const FeKey& k, uint8_t channel) {
  switch (channel) {
    case FE_K_LOOKX: return k.lookX;
    case FE_K_LOOKY: return k.lookY;
    case FE_K_BLINK: return k.blink;
    default: return k.talk;
  }
}

static inline FeKey fe_key(const FeAnimation& a, int i) {
  FeKey k;
  fe_loadKey(&a.keys[i], &k, sizeof(FeKey));
  return k;
}

static bool fe_channel(const FeAnimation& a, fe_real time, uint8_t channel, fe_real* out) {
  int first = -1, last = -1;
  for (int i = 0; i < a.count; i++) if (fe_key(a, i).has & channel) { if (first < 0) first = i; last = i; }
  if (first < 0) return false;
  const FeKey f = fe_key(a, first);
  const FeKey l = fe_key(a, last);
  if (time <= f.t) { *out = fe_keyValue(f, channel); return true; }
  if (time >= l.t) {
    if (a.loop && first != last) {
      fe_real span = (fe_real)a.duration - l.t + f.t;
      fe_real x = span > 0 ? (time - l.t) / span : 1;
      if (x > 1) x = 1;
      *out = fe_keyValue(l, channel) + (fe_keyValue(f, channel) - fe_keyValue(l, channel)) * fe_ease(x);
    } else *out = fe_keyValue(l, channel);
    return true;
  }
  FeKey p = f;
  for (int i = first + 1; i <= last; i++) {
    const FeKey n = fe_key(a, i);
    if (!(n.has & channel)) continue;
    if (time >= p.t && time <= n.t) {
      fe_real x = n.t == p.t ? 1 : (time - p.t) / (fe_real)(n.t - p.t);
      *out = fe_keyValue(p, channel) + (fe_keyValue(n, channel) - fe_keyValue(p, channel)) * fe_ease(x);
      return true;
    }
    p = n;
  }
  *out = fe_keyValue(l, channel);
  return true;
}

/** The face at time t (ms) of an animation. Looping animations wrap; others hold the end. */
static FeState feSample(const FeAnimation& a, uint32_t t, FeState base) {
  fe_real time = a.loop ? (fe_real)(t % a.duration) : (fe_real)(t < a.duration ? t : a.duration);
  FeState s = base;
  int firstMood = -1;
  for (int i = 0; i < a.count; i++) {
    const FeKey k = fe_key(a, i);
    if (!(k.has & FE_K_MOOD)) continue;
    if (firstMood < 0) { firstMood = i; s.mood = k.mood; }
    if (k.t <= time) s.mood = k.mood;
  }
  fe_real v;
  if (fe_channel(a, time, FE_K_LOOKX, &v)) s.lookX = v;
  if (fe_channel(a, time, FE_K_LOOKY, &v)) s.lookY = v;
  if (fe_channel(a, time, FE_K_BLINK, &v)) s.blink = v;
  if (fe_channel(a, time, FE_K_TALK, &v)) s.talk = v;
  return s;
}
