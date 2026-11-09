// MakerStudio AI face player (generated projects include this file unchanged).
//
// Decides what the face shows at each moment:
//   - plays an animation from face_data.h (looping ones repeat; others end and then the
//     face goes on with its idle life, keeping the animation's last mood),
//   - idle life: blinks every few seconds and glances around, like "Alive" in the app,
//   - USB serial commands (115200 baud): a digit 0-9 plays that animation, "i" = idle life.
//
// License: MIT.

#pragma once
#include <Arduino.h>
#include "face_engine.h"
#include "face_data.h"

struct FePlayer {
  int current = START_ANIMATION; // -1 = idle life
  uint32_t started = 0;
  FeState idleBase = {FE_NEUTRAL, 0, 0, 0, 0};
  // idle life
  uint32_t nextBlink = 1500, blinkStart = 0;
  bool blinking = false;
  fe_real lookX = 0, lookY = 0, targetX = 0, targetY = 0;
  uint32_t nextLook = 1000;

  void play(int index, uint32_t now) {
    if (index < 0 || index >= (int)ANIMATION_COUNT) { current = -1; return; }
    current = index;
    started = now;
  }

  void handleSerial(uint32_t now) {
    while (Serial.available()) {
      int c = Serial.read();
      if (c >= '0' && c <= '9') {
        int n = c - '0';
        if (n < (int)ANIMATION_COUNT) {
          play(n, now);
          Serial.print(F("Playing: "));
          Serial.println(ANIMATION_NAMES[n]);
        } else {
          Serial.println(F("No animation with that number."));
        }
      } else if (c == 'i' || c == 'I') {
        current = -1;
        Serial.println(F("Idle life"));
      }
    }
  }

  FeState idle(uint32_t now) {
    FeState s = idleBase;
    if (now >= nextBlink) { blinking = true; blinkStart = now; nextBlink = now + 2200 + random(0, 3200); }
    if (blinking) {
      uint32_t bt = now - blinkStart;
      if (bt < 180) s.blink = sin((fe_real)bt / 180.0 * 3.14159265358979);
      else blinking = false;
    }
    if (now >= nextLook) {
      if (random(0, 100) < 35) { targetX = 0; targetY = 0; }
      else { targetX = random(-100, 101) / 100.0; targetY = random(-60, 61) / 100.0; }
      nextLook = now + 1200 + random(0, 2400);
    }
    lookX += (targetX - lookX) * 0.2;
    lookY += (targetY - lookY) * 0.2;
    s.lookX = lookX;
    s.lookY = lookY;
    return s;
  }

  FeState update(uint32_t now) {
    handleSerial(now);
    if (current >= 0) {
      const FeAnimation& a = ANIMATIONS[current];
      uint32_t t = now - started;
      FeState base = {FE_NEUTRAL, 0, 0, 0, 0};
      FeState s = feSample(a, t, base);
      if (!a.loop && t >= a.duration) {
        // finished: carry on living with the last mood
        idleBase = {s.mood, 0, 0, 0, 0};
        current = -1;
      }
      return s;
    }
    return idle(now);
  }
};

// The interface main.cpp uses (the robot runner provides the same two functions).
static FePlayer player;
static void frameSetup() {}
static FeState frameState(uint32_t now) { return player.update(now); }
