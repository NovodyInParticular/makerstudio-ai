// AI tools (AI_ARCHITECTURE.md §4). Each tool is defined once with a zod schema.
// Read tools return data. Change tools return commands, the same ones the buttons use; they
// never touch the project themselves: proposals.ts collects them for the owner to approve.

import { z } from "zod";
import { designReport } from "./design";
import { addObject, booleanOp, cadObjects, deleteObjects, groupObjects, setParams, setProps, setText, setTransforms } from "../cad/commands";
import { DEFAULT_PARAMS, IDENTITY, KIND_LABELS, PALETTE, PRIMITIVE_KINDS, validateParams, type CadObject } from "../cad/model";
import { COMPONENTS, componentDef } from "../circuit/catalog";
import { checkCircuit } from "../circuit/checks";
import { addPart, addWire, circuitOf, deleteParts } from "../circuit/commands";
import { setNotes, type Command, type EditableState } from "../document/commands";
import { DISPLAYS } from "../display/catalog";
import { setFace } from "../display/commands";
import { FaceSpecSchema, type Screen } from "../display/face";
import { robotOf, setJoint } from "../robot/commands";
import { AXES } from "../robot/schema";
import { projectSnapshot, type SnapshotExtras } from "./context";
import { analyseDrone } from "../drone/analysis";
import { droneOf, newDroneDesign, setDrone } from "../drone/commands";

export type ToolKind = "read" | "change";

export interface ToolEnv {
  state: EditableState;
  extras: SnapshotExtras;
  newId(): string;
}

export type ToolOutput =
  | { kind: "read"; data: unknown }
  | { kind: "change"; commands: Command[]; summary: string; created?: Record<string, string> };

export interface AiTool<P = any> {
  name: string;
  description: string;
  kind: ToolKind;
  /** Deletes or replaces things: always shown as such and needs explicit approval. */
  destructive?: boolean;
  schema: z.ZodType<P>;
  run(env: ToolEnv, params: P): ToolOutput;
}

const vec3 = z.tuple([z.number(), z.number(), z.number()]);
const fail = (message: string): never => { throw new Error(message); };

function findObject(state: EditableState, ref: string): CadObject {
  const objects = cadObjects(state);
  return objects.find((o) => o.id === ref) ?? objects.find((o) => o.name === ref) ?? fail(`No 3D object with id or name "${ref}".`);
}

function findPart(state: EditableState, ref: string) {
  const parts = circuitOf(state).components;
  return parts.find((c) => c.id === ref) ?? parts.find((c) => c.label === ref) ?? fail(`No circuit part with id or label "${ref}".`);
}

function define<P>(tool: AiTool<P>): AiTool<P> {
  return tool;
}

export const TOOLS: AiTool[] = [
  // --- read ------------------------------------------------------------------------------
  define({
    name: "get_project",
    description: "Read the current project: 3D objects (ids, sizes in mm, positions, bounding boxes), circuit parts, wires and their safety check results, displays, robot joints and behaviours.",
    kind: "read",
    schema: z.object({}),
    run: (env) => ({ kind: "read", data: projectSnapshot(env.state, env.extras) }),
  }),
  define({
    name: "check_circuit",
    description: "Run MakerStudio's electrical checks on the circuit. Results never mean 'safe'; report them as found.",
    kind: "read",
    schema: z.object({}),
    run: (env) => {
      const c = circuitOf(env.state);
      return { kind: "read", data: checkCircuit(c.components, c.wires) };
    },
  }),
  define({
    name: "list_catalog",
    description: "List the parts and boards MakerStudio knows, with their pins and where each spec comes from (verified document or estimate), plus the display types. Use these specs instead of your own memory.",
    kind: "read",
    schema: z.object({ category: z.enum(["circuit", "displays", "shapes"]).optional() }),
    run: (_env, { category }) => ({
      kind: "read",
      data: {
        ...(!category || category === "circuit" ? {
          circuit: COMPONENTS.map((c) => ({
            type: c.id, name: c.name, category: c.category, notes: c.notes, source: c.source ?? null,
            props: c.props.map((p) => ({ key: p.key, kind: p.kind, default: p.default, choices: p.choices, unit: p.unit })),
            pins: c.pins.map((p) => ({ id: p.id, name: p.name, role: p.role })),
          })),
        } : {}),
        ...(!category || category === "displays" ? { displays: DISPLAYS } : {}),
        ...(!category || category === "shapes" ? { shapes: PRIMITIVE_KINDS.map((k) => ({ kind: k, defaults: DEFAULT_PARAMS[k] })) } : {}),
      },
    }),
  }),

  // --- 3D ------------------------------------------------------------------------------------
  define({
    name: "cad_add_shape",
    description: "Add a shape to the 3D Studio. Sizes in mm (box: width/depth/height; sphere: radius; cylinder: radius/height; cone: bottomRadius/topRadius/height; torus: radius/tube; wedge: width/depth/height; text: size/depth plus 'text'). Shapes stand on z = 0 at their position. Returns the new object's id.",
    kind: "change",
    schema: z.object({
      kind: z.enum(PRIMITIVE_KINDS),
      name: z.string().min(1).max(120).optional(),
      params: z.record(z.string(), z.number()).optional(),
      position: vec3.optional(),
      rotation: vec3.optional(),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      hole: z.boolean().optional(),
      text: z.string().max(200).optional(),
    }),
    run: (env, p) => {
      const id = env.newId();
      const params = validateParams(p.kind, { ...DEFAULT_PARAMS[p.kind], ...(p.params ?? {}) });
      const n = cadObjects(env.state).length;
      const object: CadObject = {
        id, name: p.name ?? `${KIND_LABELS[p.kind]} (AI)`, kind: p.kind, params,
        ...(p.kind === "text" ? { text: p.text ?? "Text" } : {}),
        transform: { ...IDENTITY, position: p.position ?? [0, 0, 0], rotation: p.rotation ?? [0, 0, 0] },
        hole: p.hole ?? false, color: p.color ?? PALETTE[n % PALETTE.length]!, parentId: null, visible: true, locked: false,
      };
      return { kind: "change", commands: [addObject({ object })], summary: `Add ${object.hole ? "hole " : ""}${KIND_LABELS[p.kind].toLowerCase()} "${object.name}"`, created: { id } };
    },
  }),
  define({
    name: "check_design",
    description: "Cross-studio design check: robot joints vs their servos in the circuit, mounted faces vs screen parts, circuit check summary, parts that do not fit the printer. Run it after building or changing a robot design, and report the findings honestly.",
    kind: "read",
    schema: z.object({}),
    run: (env) => ({ kind: "read", data: designReport(env.state, env.extras.printer) }),
  }),
  define({
    name: "cad_build",
    description: [
      "Build a whole object from several shapes in ONE call (preferred over adding shapes one by one). The parts are grouped under 'name'; parts with hole: true are cut out of the others.",
      "Coordinates in mm, Z is up, the print bed is z = 0. 'position' is the CENTRE OF THE BOTTOM of a shape: a box 20 tall at position [0,0,10] spans z 10..30. Cylinders and cones stand upright; rotate [90,0,0] to lay one along Y, [0,90,0] along X.",
      "Sizes: box width(X)/depth(Y)/height(Z); cylinder radius/height; sphere radius; cone bottomRadius/topRadius/height; torus radius/tube (lies flat); wedge width/depth/height; text size/depth + 'text'.",
      "Make touching parts overlap by about 0.5 mm so they print as one piece, keep a flat base on z = 0, and avoid parts floating in the air.",
      "Example, a mug: parts = [{kind:'cylinder', name:'Body', params:{radius:40,height:90}}, {kind:'cylinder', name:'Inside', params:{radius:36,height:90}, position:[0,0,4], hole:true}, {kind:'torus', name:'Handle', params:{radius:22,tube:5}, position:[40,0,23], rotation:[90,0,0]}].",
    ].join(" "),
    kind: "change",
    schema: z.object({
      name: z.string().min(1).max(120),
      parts: z.array(z.object({
        kind: z.enum(PRIMITIVE_KINDS),
        name: z.string().min(1).max(120).optional(),
        params: z.record(z.string(), z.number()).optional(),
        position: vec3.optional(),
        rotation: vec3.optional(),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        hole: z.boolean().optional(),
        text: z.string().max(200).optional(),
      })).min(1).max(80),
      offset: vec3.optional(),
    }),
    run: (env, p) => {
      const n0 = cadObjects(env.state).length;
      const off = p.offset ?? [0, 0, 0];
      const objects: CadObject[] = p.parts.map((part, i) => {
        const params = validateParams(part.kind, { ...DEFAULT_PARAMS[part.kind], ...(part.params ?? {}) });
        const pos = part.position ?? [0, 0, 0];
        return {
          id: env.newId(), name: part.name ?? `${KIND_LABELS[part.kind]} ${i + 1}`, kind: part.kind, params,
          ...(part.kind === "text" ? { text: part.text ?? "Text" } : {}),
          transform: { ...IDENTITY, position: [pos[0] + off[0], pos[1] + off[1], pos[2] + off[2]], rotation: part.rotation ?? [0, 0, 0] },
          hole: part.hole ?? false, color: part.color ?? PALETTE[(n0 + i) % PALETTE.length]!, parentId: null, visible: true, locked: false,
        };
      });
      const commands: Command[] = objects.map((object) => addObject({ object }));
      let id = objects[0]!.id;
      if (objects.length > 1) {
        id = env.newId();
        commands.push(groupObjects({ ids: objects.map((o) => o.id), groupId: id, name: p.name }));
      } else {
        objects[0]!.name = p.name;
      }
      const holes = objects.filter((o) => o.hole).length;
      return { kind: "change", commands, summary: `Build "${p.name}" (${objects.length} part${objects.length === 1 ? "" : "s"}${holes ? `, ${holes} cut out` : ""})`, created: { id } };
    },
  }),
  define({
    name: "cad_update",
    description: "Change a 3D object (by id or name): position/rotation (degrees)/scale, size params, name, color, hole, visible, text.",
    kind: "change",
    schema: z.object({
      object: z.string(),
      position: vec3.optional(), rotation: vec3.optional(), scale: vec3.optional(),
      params: z.record(z.string(), z.number()).optional(),
      name: z.string().min(1).max(120).optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      hole: z.boolean().optional(), visible: z.boolean().optional(), text: z.string().max(200).optional(),
    }),
    run: (env, p) => {
      const o = findObject(env.state, p.object);
      const commands: Command[] = [];
      const t = { ...(p.position ? { position: p.position } : {}), ...(p.rotation ? { rotation: p.rotation } : {}), ...(p.scale ? { scale: p.scale } : {}) };
      if (Object.keys(t).length) commands.push(setTransforms({ updates: [{ id: o.id, transform: t }] }));
      if (p.params) commands.push(setParams({ id: o.id, params: p.params }));
      const props = { ...(p.name ? { name: p.name } : {}), ...(p.color ? { color: p.color } : {}), ...(p.hole !== undefined ? { hole: p.hole } : {}), ...(p.visible !== undefined ? { visible: p.visible } : {}) };
      if (Object.keys(props).length) commands.push(setProps({ ids: [o.id], props }));
      if (p.text !== undefined) commands.push(setText({ id: o.id, text: p.text }));
      if (!commands.length) fail("Nothing to change.");
      return { kind: "change", commands, summary: `Change "${o.name}" (${Object.keys(p).filter((k) => k !== "object").join(", ")})` };
    },
  }),
  define({
    name: "cad_combine",
    description: "Combine 3D objects (ids or names): union, subtract (keeps the first, cuts the rest) or intersect. Returns the new group's id.",
    kind: "change",
    schema: z.object({ objects: z.array(z.string()).min(2).max(50), op: z.enum(["union", "subtract", "intersect"]) }),
    run: (env, p) => {
      const ids = p.objects.map((r) => findObject(env.state, r).id);
      const groupId = env.newId();
      return { kind: "change", commands: [booleanOp({ ids, groupId, op: p.op })], summary: `${p.op[0]!.toUpperCase()}${p.op.slice(1)} ${ids.length} objects`, created: { id: groupId } };
    },
  }),
  define({
    name: "cad_delete",
    description: "Delete 3D objects (ids or names).",
    kind: "change",
    destructive: true,
    schema: z.object({ objects: z.array(z.string()).min(1).max(100) }),
    run: (env, p) => {
      const objs = p.objects.map((r) => findObject(env.state, r));
      return { kind: "change", commands: [deleteObjects({ ids: objs.map((o) => o.id) })], summary: `Delete ${objs.map((o) => `"${o.name}"`).join(", ")}` };
    },
  }),

  // --- circuit ---------------------------------------------------------------------------
  define({
    name: "circuit_add_part",
    description: "Add a part or board to the Circuit Studio. 'type' is a catalog type (list_catalog). Returns the new part's id.",
    kind: "change",
    schema: z.object({
      type: z.string(), label: z.string().min(1).max(60).optional(),
      props: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).optional(),
      x: z.number().optional(), y: z.number().optional(),
    }),
    run: (env, p) => {
      const def = componentDef(p.type) ?? fail(`Unknown part type "${p.type}". Use list_catalog.`);
      const id = env.newId();
      const parts = circuitOf(env.state).components;
      const used = new Set(parts.map((c) => c.label));
      let label = p.label ?? def.name.split(" (")[0]!;
      for (let n = 2; used.has(label); n++) label = `${p.label ?? def.name.split(" (")[0]} ${n}`;
      const component = {
        id, type: def.id, label, rotation: 0 as const,
        x: p.x ?? 4 + (parts.length % 6) * 22, y: p.y ?? 4 + Math.floor(parts.length / 6) * 30,
        props: { ...Object.fromEntries(def.props.map((q) => [q.key, q.default])), ...(p.props ?? {}) },
      };
      return { kind: "change", commands: [addPart({ component })], summary: `Add ${def.name} "${label}"`, created: { id } };
    },
  }),
  define({
    name: "circuit_connect",
    description: "Connect two pins with a wire. Parts by id or label; pins by pin id (list_catalog).",
    kind: "change",
    schema: z.object({
      from: z.object({ part: z.string(), pin: z.string() }),
      to: z.object({ part: z.string(), pin: z.string() }),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    }),
    run: (env, p) => {
      const a = findPart(env.state, p.from.part), b = findPart(env.state, p.to.part);
      // Same colour code as hand-drawn wires: red for power, grey for ground, a signal colour otherwise.
      const role = (part: { type: string }, pin: string) => {
        const def = componentDef(part.type);
        const r = def?.pins.find((x) => x.id === pin)?.role.kind;
        return def?.electrical.kind === "battery" ? (pin === "+" ? "supply" : "ground") : r;
      };
      const roles = [role(a, p.from.pin), role(b, p.to.pin)];
      const auto = roles.includes("ground") ? "#8b97a5" : roles.includes("supply") || roles.includes("power-in") ? "#ff5d73" : ["#f2b84b", "#22b8c9", "#8f7cf0", "#2fd6a3"][circuitOf(env.state).wires.length % 4]!;
      const wire = { id: env.newId(), from: { component: a.id, pin: p.from.pin }, to: { component: b.id, pin: p.to.pin }, color: p.color ?? auto };
      return { kind: "change", commands: [addWire({ wire })], summary: `Wire "${a.label}" ${p.from.pin} to "${b.label}" ${p.to.pin}` };
    },
  }),
  define({
    name: "circuit_delete",
    description: "Delete circuit parts (ids or labels) and their wires.",
    kind: "change",
    destructive: true,
    schema: z.object({ parts: z.array(z.string()).min(1).max(100) }),
    run: (env, p) => {
      const parts = p.parts.map((r) => findPart(env.state, r));
      return { kind: "change", commands: [deleteParts({ ids: parts.map((c) => c.id) })], summary: `Delete ${parts.map((c) => `"${c.label}"`).join(", ")}` };
    },
  }),

  // --- displays, robot, notes ------------------------------------------------------------------
  define({
    name: "display_set_face",
    description: "Change a Display Studio face (screen id or name): eyeShape, eyeWidth, eyeHeight, eyeRound, eyeSpacing, eyeY, pupil, mouth, mouthWidth, mouthY, mouthThickness (fractions of the screen), background, foreground, cheeks (#rrggbb or empty).",
    kind: "change",
    schema: z.object({ screen: z.string(), face: FaceSpecSchema.partial() }),
    run: (env, p) => {
      const screens = env.state.document.workspaces.displays.screens as Screen[];
      const s = screens.find((x) => x.id === p.screen || x.name === p.screen) ?? fail(`No screen "${p.screen}".`);
      return { kind: "change", commands: [setFace({ id: s.id, face: p.face })], summary: `Change face "${s.name}" (${Object.keys(p.face).join(", ")})` };
    },
  }),
  define({
    name: "robot_set_joint",
    description: "Change a robot joint (id or name): axis, pivot [x,y,z] mm, min/max degrees, servo {pin, center, reversed}.",
    kind: "change",
    schema: z.object({
      joint: z.string(),
      axis: z.enum(AXES).optional(), pivot: vec3.optional(), min: z.number().optional(), max: z.number().optional(),
      servo: z.object({ pin: z.number().int().nullable().optional(), center: z.number().optional(), reversed: z.boolean().optional() }).optional(),
    }),
    run: (env, p) => {
      const j = robotOf(env.state)?.joints.find((x) => x.id === p.joint || x.name === p.joint) ?? fail(`No joint "${p.joint}".`);
      const { joint: _, servo, ...rest } = p;
      const changes = { ...rest, ...(servo ? { servo: { ...j.servo, ...servo } } : {}) };
      return { kind: "change", commands: [setJoint({ id: j.id, changes: changes as never })], summary: `Change joint "${j.name}" (${Object.keys(changes).join(", ")})` };
    },
  }),
  define({
    name: "drone_check",
    description: "Drone Studio 'Will it fly?' for the project's drone design: weight breakdown (frame from the 3D objects, parts marked estimated), thrust-to-weight, hover throttle, balance, propeller clearance, flight time and findings. Values marked estimated are typical, not measured: say so.",
    kind: "read",
    schema: z.object({}),
    run: (env) => {
      const drone = droneOf(env.state);
      if (!drone) return { kind: "read", data: { drone: null, note: "No drone design yet. drone_start creates one from the 3D objects." } };
      const r = analyseDrone(drone, cadObjects(env.state));
      const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
      return {
        kind: "read",
        data: {
          totalMass_g: round(r.total.mass), thrustToWeight: round(r.thrustToWeight, 2), hoverThrottle_pct: round(r.hoverThrottle * 100, 0),
          balanceOffset_mm: round(r.balanceOffset), propClearance_mm: round(r.propClearance), hoverMinutes_estimate: round(r.flightMinutes),
          parts: r.parts.map((x) => ({ name: x.name, mass_g: round(x.mass), estimated: x.estimated })),
          findings: r.findings.map((f) => ({ verdict: f.verdict, title: f.title, detail: f.detail })),
          design: { motors: drone.motors, motorMass_g: drone.motorMass, maxThrust_g: drone.maxThrust, propDiameter_mm: drone.propDiameter, battery: drone.battery, extras: drone.extras, density: drone.density, fill_pct: drone.fill },
        },
      };
    },
  }),
  define({
    name: "drone_start",
    description: "Start the Drone Studio design from the 3D objects: motors are placed on objects named 'Motor…' (or as an X quad sized to the frame), typical part values (estimates).",
    kind: "change",
    schema: z.object({}),
    run: (env) => {
      if (droneOf(env.state)) fail("There is already a drone design: use drone_update to change it.");
      const n = newDroneDesign(cadObjects(env.state));
      return { kind: "change", commands: [setDrone({ drone: n.drone, label: "Start drone design" })], summary: `Start a drone design (motors from ${n.from})` };
    },
  }),
  define({
    name: "drone_update",
    description: "Change the drone design: motor positions [x,y,z] mm and spin (1 = counter-clockwise, -1 = clockwise seen from above), motor/propeller mass g, max thrust per motor g, propeller diameter mm, battery {cells, capacity mAh, mass g}, other parts [{name, mass g, position [x,y,z] or null}], material density g/cm³, fill %. Only the given fields change.",
    kind: "change",
    schema: z.object({
      motors: z.array(z.object({ position: vec3, spin: z.union([z.literal(1), z.literal(-1)]) })).min(3).max(8).optional(),
      motorMass: z.number().optional(), maxThrust: z.number().optional(), propDiameter: z.number().optional(), propMass: z.number().optional(),
      battery: z.object({ cells: z.number().int().optional(), capacity: z.number().optional(), mass: z.number().optional() }).optional(),
      extras: z.array(z.object({ name: z.string(), mass: z.number(), position: vec3.nullable() })).max(30).optional(),
      density: z.number().optional(), fill: z.number().optional(), efficiency: z.number().optional(),
    }),
    run: (env, p) => {
      const drone = droneOf(env.state) ?? fail("No drone design yet: use drone_start first.");
      const { battery, ...rest } = p;
      const next = { ...drone, ...rest, ...(battery ? { battery: { ...drone.battery, ...battery } } : {}) };
      return { kind: "change", commands: [setDrone({ drone: next as never, label: "AI: change drone design" })], summary: `Change the drone design (${Object.keys(p).join(", ")})` };
    },
  }),
  define({
    name: "notes_append",
    description: "Add text to the end of the project's design notes (Markdown).",
    kind: "change",
    schema: z.object({ text: z.string().min(1).max(20000) }),
    run: (env, p) => ({ kind: "change", commands: [setNotes({ notes: `${env.state.notes}${env.state.notes && !env.state.notes.endsWith("\n") ? "\n" : ""}${p.text}` })], summary: `Add ${p.text.length} characters to the notes` }),
  }),
];

export function toolByName(name: string): AiTool | undefined {
  return TOOLS.find((t) => t.name === name);
}

/** Tool descriptions for a provider or MCP: name, description, JSON schema of the input. */
export function toolSpecs(kinds: ToolKind[] = ["read", "change"]) {
  return TOOLS.filter((t) => kinds.includes(t.kind)).map((t) => ({
    name: t.name,
    description: t.kind === "change"
      ? `${t.description} This only PROPOSES the change: the owner reviews it and must approve it in MakerStudio before anything happens.${t.destructive ? " Destructive." : ""}`
      : t.description,
    inputSchema: z.toJSONSchema(t.schema) as Record<string, unknown>,
  }));
}
