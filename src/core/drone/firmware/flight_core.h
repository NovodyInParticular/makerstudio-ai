// MakerStudio flight controller and attitude estimator: a line-by-line copy of
// src/core/drone/flight.ts (the simulator's controller). A parity test compiles this file and
// compares its outputs with the TypeScript version. Change both together.
//
// Motor outputs are a share of one motor's full thrust (0..1). Body frame: x right, y back,
// z up; quaternions are (w, x, y, z), body -> world. Plain C++ (no Arduino calls).
#pragma once
#include <math.h>

#ifndef FC_MAX_MOTORS
#define FC_MAX_MOTORS 8
#endif

struct FcPid { double angleP, rateP, rateI, rateD; };

struct FcConfig {
  int motors;
  double mixer[FC_MAX_MOTORS][4];  // rows = motors, columns = (Fz, tx, ty, tz)
  double inertia[9];               // kg m^2, row-major
  double maxThrust;                // N, one motor, full battery
  FcPid rollPitch, yaw;
  double maxTilt, maxYawRate;      // rad, rad/s
};

static inline void fcQmul(const double a[4], const double b[4], double o[4]) {
  double r0 = a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3];
  double r1 = a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2];
  double r2 = a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1];
  double r3 = a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0];
  o[0] = r0; o[1] = r1; o[2] = r2; o[3] = r3;
}
static inline void fcConj(const double q[4], double o[4]) { o[0] = q[0]; o[1] = -q[1]; o[2] = -q[2]; o[3] = -q[3]; }
static inline void fcNorm(double q[4]) {
  double n = sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
  if (n == 0) n = 1;
  q[0] /= n; q[1] /= n; q[2] /= n; q[3] /= n;
}
static inline void fcRotate(const double q[4], const double v[3], double o[3]) {
  double p[4] = {0, v[0], v[1], v[2]}, c[4], t[4];
  fcQmul(q, p, t); fcConj(q, c); fcQmul(t, c, p);
  o[0] = p[1]; o[1] = p[2]; o[2] = p[3];
}
static inline void fcAxisAngle(double x, double y, double z, double a, double o[4]) {
  o[0] = cos(a / 2); o[1] = x * sin(a / 2); o[2] = y * sin(a / 2); o[3] = z * sin(a / 2);
}
static inline void fcRotVec(const double q[4], double o[3]) {
  double s = q[0] < 0 ? -1 : 1;
  double w = fabs(q[0]); if (w > 1) w = 1;
  double sinHalf = sqrt(fmax(0.0, 1 - w * w));
  if (sinHalf < 1e-9) { o[0] = 2 * s * q[1]; o[1] = 2 * s * q[2]; o[2] = 2 * s * q[3]; return; }
  double k = (s * 2 * acos(w)) / sinHalf;
  o[0] = q[1] * k; o[1] = q[2] * k; o[2] = q[3] * k;
}
static inline double fcYaw(const double q[4]) {
  const double fwd[3] = {0, -1, 0}; double f[3];
  fcRotate(q, fwd, f);
  return atan2(f[0], -f[1]);
}
static inline double fcClamp(double v, double lo, double hi) { return v < lo ? lo : (v > hi ? hi : v); }

struct FcController {
  const FcConfig* c = nullptr;
  double integ[3] = {0, 0, 0};
  double lastOmega[3] = {0, 0, 0};

  void reset() { for (int k = 0; k < 3; k++) { integ[k] = 0; lastOmega[k] = 0; } }

  // Same as FlightController.update in flight.ts.
  void update(const double q[4], const double omega[3], double roll, double pitch, double yaw, double collective, double dt, bool airborne, double out[]) {
    double a[4], b[4], t[4], want[4], qc[4], e4[4], err[3];
    fcAxisAngle(0, 0, 1, fcYaw(q), a);
    fcAxisAngle(1, 0, 0, pitch * c->maxTilt, b);
    fcQmul(a, b, t);
    fcAxisAngle(0, 1, 0, roll * c->maxTilt, b);
    fcQmul(t, b, want);
    fcConj(q, qc);
    fcQmul(qc, want, e4);
    fcRotVec(e4, err);
    double wantRate[3] = {c->rollPitch.angleP * err[0], c->rollPitch.angleP * err[1], c->yaw.angleP * err[2] - yaw * c->maxYawRate};
    const FcPid* gains[3] = {&c->rollPitch, &c->rollPitch, &c->yaw};
    double accel[3];
    for (int k = 0; k < 3; k++) {
      double e = wantRate[k] - omega[k];
      if (airborne) integ[k] = fcClamp(integ[k] + e * dt, -2, 2);
      accel[k] = gains[k]->rateP * e + gains[k]->rateI * integ[k] - (gains[k]->rateD * (omega[k] - lastOmega[k])) / dt;
    }
    for (int k = 0; k < 3; k++) lastOmega[k] = omega[k];
    const double* J = c->inertia;
    double tau[3] = {
      J[0] * accel[0] + J[1] * accel[1] + J[2] * accel[2],
      J[3] * accel[0] + J[4] * accel[1] + J[5] * accel[2],
      J[6] * accel[0] + J[7] * accel[1] + J[8] * accel[2],
    };
    int n = c->motors;
    for (int i = 0; i < n; i++) {
      const double* m = c->mixer[i];
      out[i] = (m[0] * collective * c->maxThrust + m[1] * tau[0] + m[2] * tau[1] + m[3] * tau[2]) / c->maxThrust;
    }
    double hi = out[0], lo = out[0];
    for (int i = 0; i < n; i++) { hi = fmax(hi, out[i]); lo = fmin(lo, out[i]); }
    if (hi > 1) { for (int i = 0; i < n; i++) out[i] -= hi - 1; lo -= hi - 1; hi = 1; }
    if (lo < 0 && hi - lo <= 1) for (int i = 0; i < n; i++) out[i] -= lo;
    for (int i = 0; i < n; i++) out[i] = fcClamp(out[i], 0, 1);
  }
};

// Same as AttitudeEstimator in flight.ts.
struct FcEstimator {
  double q[4] = {1, 0, 0, 0};
  double gain = 2;

  void update(const double gyro[3], const double accel[3], double dt) {
    double an = sqrt(accel[0] * accel[0] + accel[1] * accel[1] + accel[2] * accel[2]);
    double w[3] = {gyro[0], gyro[1], gyro[2]};
    if (an > 0.5 * 9.80665 && an < 1.5 * 9.80665) {
      double a[3] = {accel[0] / an, accel[1] / an, accel[2] / an};
      double qc[4], up[3];
      const double z[3] = {0, 0, 1};
      fcConj(q, qc);
      fcRotate(qc, z, up);
      double e[3] = {a[1] * up[2] - a[2] * up[1], a[2] * up[0] - a[0] * up[2], a[0] * up[1] - a[1] * up[0]};
      for (int k = 0; k < 3; k++) w[k] += gain * e[k];
    }
    double d[4] = {1, (w[0] * dt) / 2, (w[1] * dt) / 2, (w[2] * dt) / 2}, r[4];
    fcQmul(q, d, r);
    for (int k = 0; k < 4; k++) q[k] = r[k];
    fcNorm(q);
  }
};

// Same as HeightHold in flight.ts.
struct FcHeightHold {
  double mass = 0, maxThrust = 1, maxClimb = 1.5;
  int motors = 4;
  bool holding = false;
  double hold = 0;

  void reset() { holding = false; }

  double update(double climb, double vz, double height, double up) {
    double wantVz;
    if (fabs(climb) > 0.05) {
      wantVz = fcClamp(climb, -1, 1) * maxClimb;
      holding = false;
    } else if (!holding && fabs(vz) > 0.3) {
      wantVz = 0;  // brake first, then hold the height where it stopped (no overshoot)
    } else {
      if (!holding) { hold = height; holding = true; }
      wantVz = fcClamp(1.5 * (hold - height), -maxClimb, maxClimb);
    }
    double u = fmax(0.5, up);
    return fcClamp((mass * (9.80665 + 4 * (wantVz - vz))) / u / maxThrust, 0, motors);
  }
};
