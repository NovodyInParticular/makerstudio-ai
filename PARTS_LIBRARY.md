# Parts Library

Status: design only (Phase 7 builds it). **No part data has been entered yet**, on purpose: every spec must come from a cited source.

## Verification rules

1. Every numeric spec stores `value`, `unit`, `source` (URL or document + page) and `status`:
   - `manufacturer` — from the manufacturer's datasheet or official page
   - `distributor` — from a major distributor listing (Digi-Key, Mouser, Adafruit, SparkFun, Seeed, Pololu)
   - `measured` — measured by the owner (with date)
   - `estimated` — clearly shown as an estimate in the UI, never used to claim fit or safety without a warning
2. Unknown is stored as unknown. Nothing is filled in "typical" values silently.
3. Generic modules (for example "HC-SR04 ultrasonic", "SG90 servo") vary between sellers. They are labelled **generic / clone** and their specs default to `distributor` or `estimated`.
4. CAD model field is only filled when a real file exists, with its license and whether we may redistribute it. Otherwise: "No verified CAD model — bounding box from dimensions".
5. Purchase links are informational, dated, and may go stale.

## Record schema (draft)

```jsonc
{
  "id": "seeed-xiao-esp32s3-sense",
  "category": "microcontroller",          // microcontroller | motor | driver | sensor | power | display | hardware | ...
  "manufacturer": "Seeed Studio",
  "model": "<exact model / SKU>",
  "name": "XIAO ESP32S3 Sense",
  "genericClone": false,
  "images": [{ "file": "assets/...", "license": "...", "source": "..." }],
  "dimensions": { "x": {"value": null, "unit": "mm", "source": null, "status": "unknown"}, "y": {}, "z": {} },
  "weight": {},
  "electrical": {
    "supplyVoltage": {}, "logicVoltage": {}, "currentTypical": {}, "currentMax": {},
    "gpioMaxCurrent": {}, "inputVoltageTolerance": {}
  },
  "interfaces": ["I2C", "SPI", "UART", "USB-C"],
  "pins": [{ "name": "D0", "functions": ["GPIO1", "A0"], "voltage": "3.3V", "position": {"x": 0, "y": 0} }],
  "mountingHoles": [],
  "documents": { "datasheet": "url", "website": "url" },
  "purchase": [{ "vendor": "...", "url": "...", "checked": "YYYY-MM-DD" }],
  "cad": [{ "format": "STEP", "url": "...", "license": "...", "redistributable": false }],
  "compatibility": { "notes": [], "requires": [], "conflicts": [] },
  "license": "data license of this record"
}
```

## Planned seed categories (Phase 7)

- Microcontrollers: ESP32 DevKitC, ESP32-S3 DevKitC, XIAO ESP32-S3 (Sense), Arduino Uno R3/R4, Nano, Raspberry Pi Pico/Pico W/Pico 2, Pi Zero 2 W, Pi 4/5
- Motors & drivers: N20 gear motors, SG90, MG90S, standard servos, 28BYJ-48 + ULN2003, NEMA 17, small brushless; DRV8833, TB6612FNG, L298N, A4988/DRV8825
- Sensors: HC-SR04, VL53L0X/VL53L1X, IR line/proximity, DHT22, BME280, MPU-6050, BNO055, BH1750, TTP223, HC-SR501, OV2640/OV5640, INMP441
- Power: 1S LiPo, 18650 holders, TP4056, AMS1117, MP1584, MT3608, BMS boards, switches, USB-C PD triggers
- Displays: see Display Studio (SSD1306, SH1106, ST7789, ILI9341, GC9A01, Pi displays)
- Hardware: M2/M2.5/M3 screws, nuts, heat-set inserts, standoffs, 608/623/MR bearings, shafts, gears, casters, wheels, tracks, 2020 extrusion

## Data sources being considered

| Source | License | Use |
|---|---|---|
| Manufacturer datasheets | Facts are not copyrightable; documents are linked not copied | Primary spec source |
| KiCad symbol/footprint libraries | CC-BY-SA 4.0 with exception | Pinouts/footprints reference, with attribution |
| Fritzing parts | CC-BY-SA 3.0 | Possible breadboard artwork, with attribution |
| Manufacturer STEP models | Varies per vendor | Link; bundle only if permitted |
