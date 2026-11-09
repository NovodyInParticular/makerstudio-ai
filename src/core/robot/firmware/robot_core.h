// MakerStudio AI behaviour runner (generated projects include this file unchanged).
//
// A line-by-line port of MakerStudio's behaviour runner (src/core/robot/behavior.ts): the
// robot follows its steps in fixed 10 ms ticks, with the same eased moves and the same
// pseudo-random idle life, so it moves like the preview in the app.
// No Arduino code here (robot_runner.h connects it to servos and the screen).
//
// License: MIT.

#pragma once
#include <stdint.h>
#include "face_engine.h"

#define RB_TICK_MS 10

enum RbOp : uint8_t { RB_MOOD = 0, RB_LOOK = 1, RB_MOVE = 2, RB_ANIM = 3, RB_TALK = 4, RB_BLINK = 5, RB_WAIT = 6, RB_REPEAT = 7, RB_END = 8 };

// One step. Repeats are flattened: RB_REPEAT ... RB_END, each pointing at the other.
struct RbStep {
  uint8_t op;
  uint8_t a;      // mood, joint index or animation index
  uint8_t wait;   // 1 = wait until it is done before the next step
  int32_t n;      // ms, or repeat count (0 = forever)
  fe_real x, y;   // look x/y, or move angle (x)
  uint16_t jump;  // RB_REPEAT: index of its RB_END; RB_END: index of its RB_REPEAT
};

struct RbTween { fe_real from, to; uint32_t start, ms; };

static inline fe_real rb_ease(fe_real x) { return x * x * (3 - 2 * x); }
static inline fe_real rb_tween(const RbTween& tw, uint32_t t) {
  if (tw.ms == 0 || t >= tw.start + tw.ms) return tw.to;
  return tw.from + (tw.to - tw.from) * rb_ease((fe_real)(t - tw.start) / (fe_real)tw.ms);
}

#ifndef RB_MAX_JOINTS
#define RB_MAX_JOINTS 16
#endif
#define RB_MAX_DEPTH 4

struct RbOutput {
  FeState face;
  fe_real angles[RB_MAX_JOINTS];
  bool done;
};

struct RbRunner {
  // program
  const RbStep* program;
  uint16_t length;
  bool idleLife;
  uint8_t jointCount;
  const fe_real* jointMin;
  const fe_real* jointMax;
  const FeAnimation* animations;

  // state
  uint32_t t = 0;
  uint16_t pc = 0;
  struct Loop { uint16_t begin; int32_t left; } loops[RB_MAX_DEPTH];
  uint8_t depth = 0;
  uint32_t waitUntil = 0;
  uint8_t mood = FE_NEUTRAL;
  RbTween lookX = {0, 0, 0, 0}, lookY = {0, 0, 0, 0};
  int64_t lookSetAt = -1000000000LL;
  uint32_t talkUntil = 0;
  int64_t blinkAt = -1000000000LL;
  RbTween joints[RB_MAX_JOINTS];
  int16_t anim = -1;
  uint32_t animStart = 0;
  uint32_t seed = 12345;
  uint32_t nextIdleBlink = 1500, nextGlance = 2500;
  bool done = false;
  bool started = false;

  void begin() {
    for (int i = 0; i < RB_MAX_JOINTS; i++) joints[i] = {0, 0, 0, 0};
  }

  uint32_t rand(uint32_t n) {
    seed = seed * 1103515245u + 12345u;
    return (seed >> 8) % n;
  }

  RbStep step(uint16_t i) const {
    RbStep s;
    fe_loadKey(&program[i], &s, sizeof(RbStep));
    return s;
  }

  fe_real clampJoint(uint8_t j, fe_real a) const {
    fe_real lo = jointMin[j], hi = jointMax[j];
    return a < lo ? lo : (a > hi ? hi : a);
  }

  void start(const RbStep& s, uint16_t index) {
    switch (s.op) {
      case RB_MOOD: mood = s.a; break;
      case RB_LOOK: {
        fe_real x = rb_tween(lookX, t), y = rb_tween(lookY, t);
        lookX = {x, s.x, t, (uint32_t)s.n};
        lookY = {y, s.y, t, (uint32_t)s.n};
        lookSetAt = t;
        if (s.wait) waitUntil = t + s.n;
        break;
      }
      case RB_MOVE: {
        fe_real from = rb_tween(joints[s.a], t);
        joints[s.a] = {from, clampJoint(s.a, s.x), t, (uint32_t)s.n};
        if (s.wait) waitUntil = t + s.n;
        break;
      }
      case RB_ANIM:
        anim = s.a;
        animStart = t;
        if (s.wait) waitUntil = t + animations[s.a].duration;
        break;
      case RB_TALK:
        talkUntil = t + s.n;
        if (s.wait) waitUntil = t + s.n;
        break;
      case RB_BLINK: blinkAt = t; break;
      case RB_WAIT: waitUntil = t + s.n; break;
      case RB_REPEAT:
        if (depth < RB_MAX_DEPTH) loops[depth++] = {(uint16_t)(index + 1), s.n == 0 ? -1 : s.n - 1};
        break;
    }
  }

  void advance() {
    int guard = 0;
    while (!done && t >= waitUntil && guard++ < 1000) {
      if (pc >= length) { done = true; return; }
      RbStep s = step(pc);
      if (s.op == RB_END) {
        Loop& l = loops[depth - 1];
        if (l.left != 0) { pc = l.begin; if (l.left > 0) l.left--; }
        else { depth--; pc++; }
        continue;
      }
      uint16_t here = pc++;
      start(s, here);
    }
  }

  void idle() {
    if (!idleLife) return;
    if (t >= nextIdleBlink) { blinkAt = t; nextIdleBlink = t + 2200 + rand(3200); }
    if (t >= nextGlance) {
      if ((int64_t)t - lookSetAt > 3000) {
        fe_real x0 = rb_tween(lookX, t), y0 = rb_tween(lookY, t);
        bool centre = rand(100) < 35;
        fe_real x = 0, y = 0;
        if (!centre) { x = ((fe_real)rand(201) - 100) / 100; y = ((fe_real)rand(121) - 60) / 100; }
        lookX = {x0, x, t, 400};
        lookY = {y0, y, t, 400};
      }
      nextGlance = t + 1200 + rand(2400);
    }
  }

  void advanceTo(uint32_t target) {
    if (!started) { started = true; advance(); }
    while (t + RB_TICK_MS <= target) {
      t += RB_TICK_MS;
      idle();
      advance();
    }
  }

  RbOutput output() {
    RbOutput o;
    o.face.mood = mood;
    o.face.blink = 0;
    o.face.lookX = rb_tween(lookX, t);
    o.face.lookY = rb_tween(lookY, t);
    o.face.talk = 0;
    if (t < talkUntil) {
      fe_real v = sin((fe_real)t / 90) * 0.5 + sin((fe_real)t / 37) * 0.35 + 0.15;
      o.face.talk = v > 0 ? v : 0;
    }
    int64_t bt = (int64_t)t - blinkAt;
    if (bt >= 0 && bt < 180) o.face.blink = sin((fe_real)bt / 180 * 3.141592653589793);
    if (anim >= 0) {
      const FeAnimation& a = animations[anim];
      uint32_t at = t - animStart;
      if (!a.loop && at > a.duration) {
        mood = feSample(a, a.duration, o.face).mood;
        o.face.mood = mood;
        anim = -1;
      } else {
        o.face = feSample(a, at, o.face);
      }
    }
    for (int i = 0; i < jointCount; i++) o.angles[i] = rb_tween(joints[i], t);
    o.done = done;
    return o;
  }
};
