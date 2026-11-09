// MakerStudio AI robot runner (generated projects include this file unchanged).
//
// Runs the behaviour from robot_data.h with robot_core.h, drives the servos, and gives the
// screen its face for each frame. USB serial (115200 baud): "r" restarts the behaviour.
//
// License: MIT.

#pragma once
#include <Arduino.h>
#if defined(ARDUINO_ARCH_ESP32)
#include <ESP32Servo.h>
#else
#include <Servo.h>
#endif
#include "face_engine.h"
#include "face_data.h"
#include "robot_data.h"
#include "robot_core.h"

static RbRunner runner;
static Servo servos[RB_JOINT_COUNT > 0 ? RB_JOINT_COUNT : 1];
static uint32_t runnerStart = 0;
static int lastServo[RB_JOINT_COUNT > 0 ? RB_JOINT_COUNT : 1];

static void restartBehaviour() {
  runner = RbRunner();
  runner.program = RB_PROGRAM;
  runner.length = RB_PROGRAM_LENGTH;
  runner.idleLife = RB_IDLE_LIFE;
  runner.jointCount = RB_JOINT_COUNT;
  runner.jointMin = RB_JOINT_MIN;
  runner.jointMax = RB_JOINT_MAX;
  runner.animations = ANIMATIONS;
  runner.begin();
  runnerStart = millis();
}

static void frameSetup() {
  for (int i = 0; i < RB_JOINT_COUNT; i++) {
    lastServo[i] = -1;
    if (RB_SERVO_PIN[i] >= 0) servos[i].attach(RB_SERVO_PIN[i]);
  }
  restartBehaviour();
}

/** Servo angle (0-180) for a joint angle: home position plus the joint angle (or minus, if reversed). */
static int servoAngle(int i, fe_real jointAngle) {
  fe_real a = RB_SERVO_CENTER[i] + (RB_SERVO_REVERSED[i] ? -jointAngle : jointAngle);
  if (a < 0) a = 0;
  if (a > 180) a = 180;
  return fe_round(a);
}

static FeState frameState(uint32_t now) {
  while (Serial.available()) {
    int c = Serial.read();
    if (c == 'r' || c == 'R') { restartBehaviour(); Serial.println(F("Behaviour restarted")); }
  }
  runner.advanceTo(now - runnerStart);
  RbOutput o = runner.output();
  for (int i = 0; i < RB_JOINT_COUNT; i++) {
    if (RB_SERVO_PIN[i] < 0) continue;
    int a = servoAngle(i, o.angles[i]);
    if (a != lastServo[i]) { servos[i].write(a); lastServo[i] = a; }
  }
  return o.face;
}
