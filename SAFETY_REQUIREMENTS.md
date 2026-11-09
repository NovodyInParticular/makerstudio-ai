# Safety Requirements

MakerStudio AI is used to build real electronics and mechanical parts. These checks reduce mistakes; they **cannot certify** a design. The UI never says "safe". The best result is "No problems detected by MakerStudio's checks (N checks run). This is not a guarantee."

## Severity levels

| Level | Meaning | UI |
|---|---|---|
| Danger | Likely damage, fire or injury (short across a battery, reversed LiPo) | Red, blocks simulation "power on" until acknowledged |
| Warning | Likely malfunction or component stress | Amber |
| Info | Unverified data, estimates, missing specs | Grey/teal |

Every warning names the parts/pins involved, explains why in plain language, and suggests a fix.

## Electrical checks (Circuit Studio, Robotics Studio)

| Check | Rule (initial) |
|---|---|
| Short circuit | A net path with no load between a supply and ground |
| Battery polarity | Battery/supply terminals connected to the wrong rails; polarized caps and diodes reversed |
| Missing ground | A component or board not sharing a ground with its signal source |
| GPIO voltage | Signal voltage above a pin's tolerance (e.g. 5 V into a 3.3 V ESP32 pin) |
| Overloaded pin | Load current above the pin's rated maximum (from datasheet) |
| LED/resistor | No series resistor, or computed current above the LED rating |
| Supply voltage | Supply outside a component's rated range |
| Missing regulation | Battery directly feeding a part that needs a regulated rail |
| Current budget | Sum of max currents vs regulator/battery/USB capability |
| Motor driver | Motor stall current or voltage above driver rating; motor powered from a GPIO pin |
| Display voltage | Display module supply/logic level vs board |
| Charging | LiPo connected without a charger/protection circuit |
| Unknown data | Any check that relies on an `estimated` or `unknown` spec is reported as Info, not passed |

## Mechanical checks (3D Studio, Robotics Studio, printing)

| Check | Rule (initial) |
|---|---|
| Build volume | Part bounding box larger than 256 × 256 × 256 mm (Bambu A1) |
| Thin walls | Wall thinner than ~2 nozzle widths (0.8 mm at 0.4 mm nozzle) |
| Overhangs | Faces steeper than a configurable angle (default 45°) without support |
| Non-manifold | Mesh not watertight (checked with manifold-3d) |
| Interference | Two placed parts overlap in the assembly |
| Clearance | Gap below a configurable minimum around parts, connectors and moving parts |
| Mounting | Hole diameter vs screw size (clearance/tap/heat-set insert tables, cited) |
| Weak geometry | Very thin features or small cross-sections carrying a mount (heuristic, labelled as such) |

## Simulation honesty

- Results from ngspice or a real MCU emulator carry a **"Simulated (SPICE)"** / **"Emulated (AVR/RP2040)"** badge.
- Anything animated without a solver carries a **"Visual demo — not simulated"** badge.
- Simulation does not model heat, battery chemistry, EMI or mechanical stress; the UI says so.

## AI

- The safety engine runs on every AI-proposed change before approval.
- The AI cannot suppress or acknowledge warnings on the user's behalf.
