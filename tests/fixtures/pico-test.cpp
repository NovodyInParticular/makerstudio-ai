#include <Arduino.h>
// Pico test: blink GP15 every 100 ms, PWM 25 % on GP16, echo a pull-up button on GP14 to GP13, print A0 (GP26).
void setup() {
  pinMode(15, OUTPUT); pinMode(13, OUTPUT); pinMode(14, INPUT_PULLUP);
  analogWrite(16, 64);
  Serial.begin(115200);
}
unsigned long last = 0; bool on = false; int n = 0;
void loop() {
  if (millis() - last >= 100) { last = millis(); on = !on; digitalWrite(15, on); Serial.print("hello pico A0="); Serial.println(analogRead(A0)); }
  digitalWrite(13, digitalRead(14) == LOW);
}
