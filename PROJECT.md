# MakerStudio AI

**Your AI-powered engineering and robotics workshop.**

MakerStudio AI is an original desktop application (Windows 10/11 and Linux, including Omarchy/Arch) that combines:

1. 3D CAD modeling (primitives, transforms, Boolean operations, holes, alignment, grouping)
2. Electronics / breadboard circuit design
3. Circuit simulation (real SPICE analysis, clearly separated from visual-only demos)
4. Robotics design and assembly (real parts placed in 3D with a printable chassis around them)
5. A real-world electronics and robotics parts library
6. Display / screen design for small robot screens (OLED, TFT)
7. An AI engineering assistant with Observe, Assist and Create modes
8. 3D printing preparation for a Bambu Lab A1 (256 × 256 × 256 mm, 0.4 mm nozzle)
9. Engineering safety and compatibility validation

No Android or iOS version is planned.

## Status

Phase 2 (desktop foundation) is built and **awaiting owner approval**.
See `BUILD_STATUS.md` for live status and `ROADMAP.md` for the plan.

## Guiding rules

- Work in phases; each phase is tested and approved before the next one starts.
- Never present unfinished features as finished. Never fake simulation results. Never invent hardware specifications.
- Every AI change to a design is previewed, approved, undoable and recorded in history.
- Only open-source dependencies with licenses compatible with distributing a desktop app (see `ARCHITECTURE.md` §4).
- Original implementation. Tinkercad is studied only through public documentation for workflow ideas (see `TINKERCAD_RESEARCH.md`); no code, assets or branding are copied.

## Document map

| File | Purpose |
|---|---|
| `PROJECT.md` | This overview |
| `ARCHITECTURE.md` | Technology choices, licenses, module layout, data formats |
| `TINKERCAD_RESEARCH.md` | Observable workflow research and how we improve on it |
| `ROADMAP.md` | Phases 1–11 with tasks and acceptance tests |
| `BUILD_STATUS.md` | What is actually built and tested right now |
| `CHANGELOG.md` | Dated change log |
| `PARTS_LIBRARY.md` | Parts catalog schema, data sources and verification rules |
| `AI_ARCHITECTURE.md` | AI providers, context engine, tool interface, approval/undo |
| `SAFETY_REQUIREMENTS.md` | Electrical and mechanical checks and how warnings are presented |

## Related existing work on this machine

