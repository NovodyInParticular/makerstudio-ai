// Small displays used on robots. Resolution and colour depth come from the controller
// datasheets or, for complete boards, the manufacturer's product page. Physical module sizes
// vary between sellers, so they are given only where the source states them.

export type ColorMode = "mono" | "rgb565";

export interface DisplaySpec {
  id: string;
  name: string;
  controller: string;
  width: number;
  height: number;
  color: ColorMode;
  /** Round panels show only the inscribed circle. */
  round?: boolean;
  /** Typical diagonal, inches, where the source states it. */
  diagonal?: number;
  bus: string;
  notes: string;
  source: string;
}

export const DISPLAYS: DisplaySpec[] = [
  {
    id: "m5stack-cores3",
    name: "M5Stack CoreS3 screen",
    controller: "ILI9342C / ILI9342E",
    width: 320, height: 240, color: "rgb565", diagonal: 2.0,
    bus: "built in (SPI)",
    notes: "2.0\" IPS with capacitive touch (FT6336U), on an ESP32-S3 board with camera, proximity sensor, IMU, speaker and two microphones. The standard Stack-chan board.",
    source: "docs.m5stack.com/en/core/CoreS3 (checked 2026-11-08)",
  },
  {
    id: "m5stack-core2",
    name: "M5Stack Core2 screen",
    controller: "ILI9342C / ILI9342E",
    width: 320, height: 240, color: "rgb565", diagonal: 2.0,
    bus: "built in (SPI)",
    notes: "2.0\" IPS with capacitive touch (FT6336U), on an ESP32 board with IMU, speaker, microphone and vibration motor.",
    source: "docs.m5stack.com/en/core/core2 (checked 2026-11-08)",
  },
  {
    id: "ssd1306-128x64",
    name: "SSD1306 OLED 128 × 64",
    controller: "SSD1306",
    width: 128, height: 64, color: "mono",
    bus: "I²C or SPI",
    notes: "The classic small monochrome OLED (often 0.96\"). Some modules show the top rows in a different colour; the controller itself is single-colour.",
    source: "Solomon Systech SSD1306 datasheet (128 × 64 dot matrix)",
  },
  {
    id: "ssd1306-128x32",
    name: "SSD1306 OLED 128 × 32",
    controller: "SSD1306",
    width: 128, height: 32, color: "mono",
    bus: "I²C",
    notes: "Wide, short monochrome OLED (the same controller driving 32 rows).",
    source: "Solomon Systech SSD1306 datasheet",
  },
  {
    id: "sh1106-128x64",
    name: "SH1106 OLED 128 × 64",
    controller: "SH1106",
    width: 128, height: 64, color: "mono",
    bus: "I²C or SPI",
    notes: "Common on larger (often 1.3\") monochrome OLED modules. The controller has 132 columns of memory; modules show 128.",
    source: "Sino Wealth SH1106 datasheet (132 × 64)",
  },
  {
    id: "gc9a01-240",
    name: "GC9A01 round 240 × 240",
    controller: "GC9A01",
    width: 240, height: 240, color: "rgb565", round: true,
    bus: "SPI",
    notes: "Round colour TFT, popular for robot eyes (one screen per eye, or one face).",
    source: "GalaxyCore GC9A01 datasheet (240 × 240)",
  },
  {
    id: "st7789-240x240",
    name: "ST7789 TFT 240 × 240",
    controller: "ST7789",
    width: 240, height: 240, color: "rgb565",
    bus: "SPI",
    notes: "Square colour TFT modules.",
    source: "Sitronix ST7789 datasheet (up to 240 × 320)",
  },
  {
    id: "st7789-240x320",
    name: "ST7789 TFT 240 × 320",
    controller: "ST7789",
    width: 320, height: 240, color: "rgb565",
    bus: "SPI",
    notes: "Colour TFT, shown here in landscape.",
    source: "Sitronix ST7789 datasheet (240 × 320)",
  },
  {
    id: "ili9341-240x320",
    name: "ILI9341 TFT 240 × 320",
    controller: "ILI9341",
    width: 320, height: 240, color: "rgb565",
    bus: "SPI",
    notes: "Widely used colour TFT (often 2.4\" or 2.8\", many with touch), shown in landscape.",
    source: "Ilitek ILI9341 datasheet (240 × 320)",
  },
];

export function displayById(id: string): DisplaySpec | undefined {
  return DISPLAYS.find((d) => d.id === id);
}
