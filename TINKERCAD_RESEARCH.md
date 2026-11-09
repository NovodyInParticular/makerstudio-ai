# Tinkercad Workflow Research

Date: 2026-11-08 (Phase 1)

## Method and limitations

- **Update 2026-11-08:** the owner clarified that "REA" means *reverse engineer*. Tinkercad is Autodesk's proprietary service, so this project will not decompile, extract or copy its code, assets or data. Permitted approach: study how it *behaves* — the owner logs into Tinkercad in a browser session, and workflows are observed and documented from the outside. Findings from that session will be added here.
- **REA was not available** (as a tool, in Phase 1). No command, package, Python/npm module or MCP server named REA exists on this machine, and the term did not match any installed tool. If REA is a specific tool the owner has in mind, it needs to be installed or explained; this section will then be extended with first-hand observations.
- Tinkercad was **not** opened or driven interactively in this phase. It requires an Autodesk account login, and automating it was not authorized.
- Sources used: publicly available tutorials and guides found by web search (university library guides, a published Tinkercad keyboard shortcut sheet, All3DP tutorials). These are secondary sources; the official Tinkercad help centre did not come up in search results. Everything below is limited to what those sources say, and anything not confirmed is marked.
- No proprietary code, assets or branding were examined or copied.

Sources:
- Tinkercad keyboard shortcut sheet: https://images.tinkercad.com/jl5ii4oqrdmc/24W19aTK6wTT0YydFO3xZd/ffda269b296a25b9ce3b8a19e65bf571/Tinkercad_keyboard_shortcuts_1_up.pdf
- UTHSCSA workplane guide: https://libguides.uthscsa.edu/3Dmodeling/workplane and tips: https://libguides.uthscsa.edu/3Dmodeling/tips
- All3DP tutorial: https://all3dp.com/1/2019-tinkercad-tutorial-5-easy-steps-for-beginners/
- Warwick WMG basic instructions: https://warwick.ac.uk/fac/sci/wmg/about/outreach/resources/tinkercad/tinkercad_basic_instructions.pdf
- WWU guide: https://stc.wwu.edu/sites/stc.wwu.edu/files/2020-08/TinkerCAD_0.pdf

## Observed workflows (from public sources)

### 3D modeling
- **Shapes panel → drag onto workplane.** Primitives are dragged from a side panel onto a gridded workplane.
- **Solid vs hole.** Any shape can be switched between "solid" and "hole". Selecting a solid and a hole (Shift+click) and pressing Group subtracts the hole. Union and subtraction are therefore one gesture (Group) and the hole flag decides which.
- **Align tool (shortcut L).** Select several objects, press Align, then click handles to align along X/Y/Z by min, centre or max.
- **Workplane tool (shortcut W).** Click the workplane tool, then a face, to place new shapes on that face.
- **Handles** on the selected shape for size, height lift and rotation; dimension fields can be typed.
- Keyboard shortcuts exist for group/ungroup, duplicate, align, workplane and others (per the shortcut sheet).

### Circuits
- One summary source describes Circuits as SPICE-based with a virtual breadboard and drag-in components including microcontrollers. **Not confirmed from official documentation.**

### Not researched (needs first-hand or official sources)
- Intersection Boolean, ruler/measurement tool details, export dialogs, project management, simulation controls and microcontroller code editing.

## Functional requirements derived

1. Drag-from-library onto a snapping grid workplane.
2. A "hole" flag on every object, plus explicit Union / Subtract / Intersect commands (Tinkercad's Group-with-holes is learnable but hides intent).
3. Align by min/centre/max on each axis for multiple objects.
4. Face-picked workplanes for placing parts on other parts.
5. Direct-manipulation handles **and** typed exact dimensions.
6. Keyboard shortcuts for every frequent action.

## Opportunities to improve (original ideas)

| Area | Improvement |
|---|---|
| Precision | Real B-rep solids with fillets/chamfers and STEP export, not only meshes |
| Parametric | Each object keeps its feature history, editable later (change a hole diameter after grouping) |
| Mechanical + electronics | Real parts with real dimensions placed in the same 3D space as the chassis |
| Printing | Built-in Bambu A1 checks: build volume, orientation, thin walls, overhangs |
| AI | The AI reads the structured scene and proposes editable changes with preview/approve/undo |
| Simulation honesty | A visible badge separating real SPICE results from visual-only demos |
| Offline | Desktop app, projects saved locally, local AI possible through Ollama |
