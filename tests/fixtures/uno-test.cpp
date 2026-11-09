#include <Arduino.h>
// Test sketch: blink D13 every 100 ms, PWM 25% on D9, echo a button on D2 (pull-up) to D12, print A0.
void setup() {
  pinMode(13, OUTPUT); pinMode(12, OUTPUT); pinMode(2, INPUT_PULLUP);
  analogWrite(9, 64);
  Serial.begin(115200);
  Serial.println("hello from the uno");
}
unsigned long last = 0; bool on = false;
void loop() {
  if (millis() - last >= 100) { last = millis(); on = !on; digitalWrite(13, on); Serial.print("A0="); Serial.println(analogRead(A0)); }
  digitalWrite(12, digitalRead(2) == LOW);
}
