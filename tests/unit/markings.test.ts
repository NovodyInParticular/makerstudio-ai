import { describe, expect, it } from "vitest";
import { capacitorCode, resistorBands } from "../../src/core/circuit/markings";

describe("part markings", () => {
  it("resistor colour bands follow the standard code", () => {
    expect(resistorBands(220).names).toEqual(["red", "red", "brown", "gold"]);
    expect(resistorBands(10000).names).toEqual(["brown", "black", "orange", "gold"]);
    expect(resistorBands(4700).names).toEqual(["yellow", "violet", "red", "gold"]);
    expect(resistorBands(330).names).toEqual(["orange", "orange", "brown", "gold"]);
    expect(resistorBands(10).names).toEqual(["brown", "black", "black", "gold"]);
    expect(resistorBands(4.7).names).toEqual(["yellow", "violet", "gold", "gold"]);
    expect(resistorBands(1e6).names).toEqual(["brown", "black", "green", "gold"]);
  });
  it("ceramic capacitor codes are in picofarads", () => {
    expect(capacitorCode(0.1)).toBe("104");
    expect(capacitorCode(0.01)).toBe("103");
    expect(capacitorCode(0.000022)).toBe("22");
    expect(capacitorCode(1)).toBe("105");
    expect(capacitorCode(0.0047)).toBe("472");
  });
});
