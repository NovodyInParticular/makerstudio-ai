// The 3D viewport: bed, grid, shapes, selection, transform gizmo and camera.

import { GizmoHelper, GizmoViewport, Grid, Html, Line, OrbitControls, OrthographicCamera, PerspectiveCamera, TransformControls } from "@react-three/drei";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { importModelFile, isModelFile } from "./fileActions";
import { Box3, BufferAttribute, BufferGeometry, DoubleSide, EdgesGeometry, MathUtils, Matrix3, Object3D, Quaternion, OrthographicCamera as OrthoCam, PerspectiveCamera as PerspCam, Plane, Raycaster, Vector2, Vector3, type Camera } from "three";
import { setTransforms } from "../../core/cad/commands";
import { solidMesh } from "../../core/cad/csg";
import { buildGeometry, worldBounds } from "../../core/cad/geometry";
import { EDGE_LINE_TRIANGLE_LIMIT, sharedMeshGeometry, triangleCount } from "./meshDisplay";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { PRIMITIVE_KINDS, type CadObject, type PrimitiveKind } from "../../core/cad/model";
import { useProject, useUi } from "../state";
import { addPrimitive, clickTarget, currentObjects, run, useCad } from "./cadState";

// CAD convention: Z is up. Must be set before any camera is created.
Object3D.DEFAULT_UP.set(0, 0, 1);

const DEG = Math.PI / 180;
const HOME = new Vector3(170, -230, 170);

/** Shared between the canvas and the drop handler outside it. */
const bridge: { camera: Camera | null; controls: { target: Vector3; update(): void } | null; objects: Map<string, Object3D>; lastGizmoUse: number } = {
  camera: null,
  controls: null,
  objects: new Map(),
  lastGizmoUse: 0,
};

const round3 = (v: Vector3): [number, number, number] => [Math.round(v.x * 1000) / 1000, Math.round(v.y * 1000) / 1000, Math.round(v.z * 1000) / 1000];

/** What a click on a shape does, depending on the active tool. */
function pick(e: ThreeEvent<MouseEvent>, objectId: string) {
  e.stopPropagation();
  if (e.delta > 4) return; // it was a camera drag, not a click
  const cad = useCad.getState();
  if (cad.tool === "measure") {
    cad.addMeasurePoint(round3(e.point));
    return;
  }
  if (cad.tool === "workplane") {
    const n = e.face ? e.face.normal.clone().applyMatrix3(new Matrix3().getNormalMatrix(e.object.matrixWorld)).normalize() : new Vector3(0, 0, 1);
    cad.setWorkplane({ origin: round3(e.point), normal: round3(n) });
    cad.setTool("select");
    return;
  }
  const target = clickTarget(objectId);
  if (e.shiftKey || e.ctrlKey || e.metaKey) cad.toggle(target);
  else cad.select([target]);
}

function SurfaceMaterial({ color, hole, selected }: { color: string; hole: boolean; selected: boolean }) {
  return (
    <meshStandardMaterial
      color={hole ? "#9aa5ae" : color}
      transparent={hole}
      opacity={hole ? 0.35 : 1}
      depthWrite={!hole}
      roughness={0.55}
      metalness={0.05}
      emissive={selected ? "#2fd6a3" : "#000000"}
      emissiveIntensity={selected ? 0.22 : 0}
      polygonOffset
      polygonOffsetFactor={1}
      polygonOffsetUnits={1}
    />
  );
}

function EdgeLines({ geometry, selected, hole }: { geometry: BufferGeometry; selected: boolean; hole: boolean }) {
  const edges = useMemo(() => (triangleCount(geometry) > EDGE_LINE_TRIANGLE_LIMIT ? null : new EdgesGeometry(geometry, 25)), [geometry]);
  useEffect(() => () => edges?.dispose(), [edges]);
  if (!edges) return null;
  return (
    <lineSegments geometry={edges} raycast={() => null}>
      <lineBasicMaterial color={selected ? "#9dffe4" : hole ? "#d0d7dc" : "#06080a"} transparent opacity={selected ? 1 : 0.75} />
    </lineSegments>
  );
}

function usePrimitiveGeometry(object: CadObject) {
  const shared = object.kind === "mesh";
  const geometry = useMemo(() => (shared ? sharedMeshGeometry(object) : buildGeometry(object)), [object.kind, object.params, object.text, object.mesh]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (!shared) geometry?.dispose(); }, [geometry, shared]);
  return geometry;
}

/** Turns a solid-engine result into a displayable surface with crisp edges and smooth curves. */
function useSolidGeometry(object: CadObject, all: CadObject[]) {
  const mesh = useMemo(() => {
    try {
      return solidMesh(object, all);
    } catch (error) {
      useUi.getState().notify("error", error instanceof Error ? error.message : String(error));
      return null;
    }
  }, [object, all]);
  const geometry = useMemo(() => {
    if (!mesh || mesh.empty) return null;
    const indexed = new BufferGeometry();
    indexed.setAttribute("position", new BufferAttribute(mesh.positions, 3));
    indexed.setIndex(new BufferAttribute(mesh.indices, 1));
    const smooth = toCreasedNormals(indexed, 30 * DEG);
    indexed.dispose();
    return smooth;
  }, [mesh]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  return geometry;
}

type Common = { ref(o: Object3D | null): void; name: string; position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number]; visible: boolean };

function commonProps(object: CadObject): Common {
  const t = object.transform;
  return {
    ref: (o) => {
      if (o) bridge.objects.set(object.id, o);
      else bridge.objects.delete(object.id);
    },
    name: object.id,
    position: t.position,
    rotation: [t.rotation[0] * DEG, t.rotation[1] * DEG, t.rotation[2] * DEG],
    scale: t.scale,
    visible: object.visible,
  };
}

function PrimitiveNode({ object, selected }: { object: CadObject; selected: boolean }) {
  const geometry = usePrimitiveGeometry(object);
  if (!geometry) return null;
  return (
    <mesh {...commonProps(object)} geometry={geometry} dispose={null} onClick={(e) => pick(e, object.id)}>
      <SurfaceMaterial color={object.color} hole={object.hole} selected={selected} />
      <EdgeLines geometry={geometry} selected={selected} hole={object.hole} />
    </mesh>
  );
}

/** A group drawn as one solid: solids combined, holes cut out. */
function SolidGroupNode({ object, all, selection }: { object: CadObject; all: CadObject[]; selection: Set<string> }) {
  const geometry = useSolidGeometry(object, all);
  const selected = selection.has(object.id) || isInsideSelected(object, all, selection);
  const children = all.filter((o) => o.parentId === object.id);
  return (
    <group {...commonProps(object)}>
      {geometry && (
        <mesh geometry={geometry} dispose={null} onClick={(e) => pick(e, object.id)}>
          <SurfaceMaterial color={object.color} hole={object.hole} selected={selected} />
          <EdgeLines geometry={geometry} selected={selected} hole={object.hole} />
        </mesh>
      )}
      {children.map((c) => <GhostNode key={c.id} object={c} all={all} selection={selection} />)}
    </group>
  );
}

/**
 * A shape inside a combined group. It is not drawn on its own (the group's solid shows it),
 * but it keeps its place so it can be selected from the object list and moved with the handles;
 * when selected it shows as a see-through outline.
 */
function GhostNode({ object, all, selection }: { object: CadObject; all: CadObject[]; selection: Set<string> }) {
  const selected = selection.has(object.id);
  const children = all.filter((o) => o.parentId === object.id);
  return (
    <group {...commonProps(object)}>
      {selected && <GhostShape object={object} all={all} />}
      {children.map((c) => <GhostNode key={c.id} object={c} all={all} selection={selection} />)}
    </group>
  );
}

function GhostShape({ object, all }: { object: CadObject; all: CadObject[] }) {
  const primitive = usePrimitiveGeometry(object);
  const solid = useSolidGeometry(object, all);
  const geometry = object.kind === "group" ? solid : primitive;
  if (!geometry) return null;
  return (
    <mesh geometry={geometry} dispose={null} raycast={() => null} renderOrder={10}>
      <meshBasicMaterial color={object.hole ? "#ff8a7a" : "#2fd6a3"} transparent opacity={0.22} depthTest={false} depthWrite={false} />
      {triangleCount(geometry) <= EDGE_LINE_TRIANGLE_LIMIT && (
        <lineSegments raycast={() => null} renderOrder={11}>
          <edgesGeometry args={[geometry, 25]} />
          <lineBasicMaterial color={object.hole ? "#ffb3a8" : "#9dffe4"} depthTest={false} transparent />
        </lineSegments>
      )}
    </mesh>
  );
}

function SceneNode({ object, all, selection }: { object: CadObject; all: CadObject[]; selection: Set<string> }) {
  const csg = useCad((s) => s.csgReady);
  if (object.kind === "group") {
    if (csg) return <SolidGroupNode object={object} all={all} selection={selection} />;
    // Engine still loading: show the parts as they are.
    const children = all.filter((o) => o.parentId === object.id);
    return (
      <group {...commonProps(object)}>
        {children.map((c) => <SceneNode key={c.id} object={c} all={all} selection={selection} />)}
      </group>
    );
  }
  return <PrimitiveNode object={object} selected={selection.has(object.id) || isInsideSelected(object, all, selection)} />;
}

function isInsideSelected(object: CadObject, all: CadObject[], selection: Set<string>): boolean {
  let parentId = object.parentId;
  let guard = 0;
  while (parentId && guard++ < 100) {
    if (selection.has(parentId)) return true;
    parentId = all.find((o) => o.id === parentId)?.parentId ?? null;
  }
  return false;
}

/** Triangles picked out by the print check, drawn over the model: overhangs red, thin walls amber. */
function triangleGeometry(parts: { positions: Float32Array; indices: Uint32Array }[], lists: Uint32Array[]): BufferGeometry | null {
  let count = 0;
  for (const l of lists) count += l.length;
  if (count === 0) return null;
  const out = new Float32Array(count * 9);
  let o = 0;
  parts.forEach((part, p) => {
    for (const t of lists[p]!) {
      for (let c = 0; c < 3; c++) {
        const v = part.indices[t * 3 + c]! * 3;
        out[o++] = part.positions[v]!; out[o++] = part.positions[v + 1]!; out[o++] = part.positions[v + 2]!;
      }
    }
  });
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(out, 3));
  return g;
}

function PrintIssueOverlay() {
  const check = useCad((s) => s.printCheck);
  const show = useCad((s) => s.showPrintIssues);
  const objects = useProject((s) => s.project.document.workspaces.cad.objects as CadObject[]);
  const current = check !== null && check.objects === objects;
  const geometries = useMemo(() => {
    if (!check || !current) return null;
    return {
      overhang: triangleGeometry(check.parts, check.report.parts.map((p) => p.overhangTriangles)),
      thin: triangleGeometry(check.parts, check.report.parts.map((p) => p.thinTriangles)),
    };
  }, [check, current]);
  useEffect(() => () => { geometries?.overhang?.dispose(); geometries?.thin?.dispose(); }, [geometries]);
  if (!geometries || !show) return null;
  return (
    <group renderOrder={2}>
      {geometries.overhang && (
        <mesh geometry={geometries.overhang} raycast={() => null}>
          <meshBasicMaterial color="#ff5d73" transparent opacity={0.8} side={DoubleSide} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} depthWrite={false} />
        </mesh>
      )}
      {geometries.thin && (
        <mesh geometry={geometries.thin} raycast={() => null}>
          <meshBasicMaterial color="#ffb02e" transparent opacity={0.85} side={DoubleSide} polygonOffset polygonOffsetFactor={-3} polygonOffsetUnits={-3} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}

/** Catches clicks on the empty bed while measuring or choosing a workplane. */
function PickPlane() {
  const tool = useCad((s) => s.tool);
  if (tool === "select") return null;
  return (
    <mesh position={[0, 0, 0]} onClick={(e) => {
      e.stopPropagation();
      if (e.delta > 4) return;
      const cad = useCad.getState();
      if (cad.tool === "measure") cad.addMeasurePoint(round3(e.point));
      else if (cad.tool === "workplane") {
        cad.setWorkplane(null); // clicking the bed returns to the bed workplane
        cad.setTool("select");
      }
    }}>
      <planeGeometry args={[5000, 5000]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

function MeasureOverlay() {
  const points = useCad((s) => s.measure);
  if (points.length === 0) return null;
  const [a, b] = points;
  const marker = (p: [number, number, number], key: string) => (
    <mesh key={key} position={p} raycast={() => null} renderOrder={20}>
      <sphereGeometry args={[0.9, 16, 12]} />
      <meshBasicMaterial color="#f2b84b" depthTest={false} />
    </mesh>
  );
  if (!b) return <>{marker(a!, "a")}</>;
  const va = new Vector3(...a!), vb = new Vector3(...b);
  const mid = va.clone().add(vb).multiplyScalar(0.5);
  const fmt = (n: number) => (Math.round(n * 100) / 100).toString();
  return (
    <>
      {marker(a!, "a")}
      {marker(b, "b")}
      <Line points={[a!, b]} color="#f2b84b" lineWidth={2} depthTest={false} renderOrder={20} />
      <Html position={mid.toArray()} center zIndexRange={[5, 0]}>
        <div className="measure-label" data-testid="measure-label">
          <b>{fmt(va.distanceTo(vb))} mm</b>
          <span>ΔX {fmt(vb.x - va.x)} · ΔY {fmt(vb.y - va.y)} · ΔZ {fmt(vb.z - va.z)}</span>
        </div>
      </Html>
    </>
  );
}

function WorkplaneMarker() {
  const workplane = useCad((s) => s.workplane);
  if (!workplane) return null;
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(...workplane.normal));
  const h = 30;
  return (
    <group position={workplane.origin} quaternion={q}>
      <mesh position={[0, 0, 0.05]} raycast={() => null}>
        <planeGeometry args={[h * 2, h * 2]} />
        <meshBasicMaterial color="#22b8c9" transparent opacity={0.12} depthWrite={false} side={DoubleSide} />
      </mesh>
      <Line points={[[-h, -h, 0.06], [h, -h, 0.06], [h, h, 0.06], [-h, h, 0.06], [-h, -h, 0.06]]} color="#22b8c9" lineWidth={1.5} />
      <Line points={[[0, 0, 0.06], [0, 0, 12]]} color="#22b8c9" lineWidth={2} />
    </group>
  );
}

export function Bed() {
  const printer = useUi((s) => s.settings?.printer);
  const x = (printer?.bedX ?? 256) / 2, y = (printer?.bedY ?? 256) / 2;
  return (
    <group>
      <mesh position={[0, 0, -0.05]}>
        <planeGeometry args={[x * 2, y * 2]} />
        <meshStandardMaterial color="#15191d" roughness={0.9} />
      </mesh>
      <Line points={[[-x, -y, 0.02], [x, -y, 0.02], [x, y, 0.02], [-x, y, 0.02], [-x, -y, 0.02]]} color="#2fd6a3" lineWidth={1.5} transparent opacity={0.7} />
      <Grid
        rotation={[Math.PI / 2, 0, 0]}
        position={[0, 0, 0.01]}
        args={[x * 2, y * 2]}
        cellSize={10}
        cellThickness={0.6}
        cellColor="#2a3138"
        sectionSize={50}
        sectionThickness={1}
        sectionColor="#38515a"
        fadeDistance={2000}
        infiniteGrid
        followCamera={false}
      />
    </group>
  );
}

function Gizmo() {
  const selection = useCad((s) => s.selection);
  const mode = useCad((s) => s.gizmo);
  const objects = useProject((s) => s.project.document.workspaces.cad.objects as CadObject[]);
  const settings = useUi((s) => s.settings);
  const [target, setTarget] = useState<Object3D | null>(null);
  const id = selection.length === 1 ? selection[0]! : null;
  const object = id ? objects.find((o) => o.id === id) : undefined;

  useEffect(() => {
    if (!object || object.locked) { setTarget(null); return; }
    // Only attach to a 3D object that is in the scene. A change (e.g. hole on/off) can rebuild
    // it; then the new one registers after this effect, so look again on the next frame.
    const live = () => { const o = bridge.objects.get(object.id); return o && o.parent ? o : null; };
    const now = live();
    setTarget(now);
    if (now) return;
    const frame = requestAnimationFrame(() => setTarget(live()));
    return () => cancelAnimationFrame(frame);
  }, [object]);

  if (!target || !object) return null;
  const snap = settings?.snapEnabled ?? true;
  const grid = settings?.gridSize ?? 1;

  const commit = () => {
    bridge.lastGizmoUse = performance.now();
    const p = target.position, r = target.rotation, s = target.scale;
    const round = (n: number, digits = 4) => Number(n.toFixed(digits));
    const ok = run(setTransforms({
      updates: [{
        id: object.id,
        transform: {
          position: [round(p.x), round(p.y), round(p.z)],
          rotation: [round(r.x / DEG, 3), round(r.y / DEG, 3), round(r.z / DEG, 3)],
          scale: [round(Math.max(s.x, 0.001)), round(Math.max(s.y, 0.001)), round(Math.max(s.z, 0.001))],
        },
      }],
      label: mode === "translate" ? "Move" : mode === "rotate" ? "Rotate" : "Scale",
    }));
    if (!ok) {
      // Put the 3D object back where the project says it is.
      const t = object.transform;
      target.position.set(...t.position);
      target.rotation.set(t.rotation[0] * DEG, t.rotation[1] * DEG, t.rotation[2] * DEG);
      target.scale.set(...t.scale);
    }
  };

  return (
    <TransformControls
      object={target}
      mode={mode}
      translationSnap={snap ? grid : null}
      rotationSnap={snap ? 15 * DEG : null}
      scaleSnap={snap ? 0.05 : null}
      size={0.8}
      onMouseDown={() => (bridge.lastGizmoUse = performance.now())}
      onMouseUp={commit}
    />
  );
}

function CameraRig() {
  const { camera, controls, size } = useThree();
  const request = useCad((s) => s.viewRequest);
  const mode = useCad((s) => s.camera);
  const previous = useRef<{ camera: Camera; mode: string } | null>(null);

  useEffect(() => {
    bridge.camera = camera;
    bridge.controls = controls as unknown as typeof bridge.controls;
  }, [camera, controls]);

  // Keep the view when switching between perspective and orthographic.
  useEffect(() => {
    const last = previous.current;
    const prev = last?.camera;
    // Only carry the view over when the user switched modes, not when the canvas swaps in its
    // initial placeholder camera for ours.
    if (last && prev && prev !== camera && last.mode !== mode) {
      camera.position.copy(prev.position);
      camera.quaternion.copy(prev.quaternion);
      const target = bridge.controls?.target ?? new Vector3();
      const distance = prev.position.distanceTo(target);
      if (camera instanceof OrthoCam) {
        camera.zoom = size.height / (2 * distance * Math.tan(MathUtils.degToRad(45) / 2));
        camera.updateProjectionMatrix();
      } else if (prev instanceof OrthoCam && camera instanceof PerspCam) {
        const d = size.height / (2 * prev.zoom * Math.tan(MathUtils.degToRad(camera.fov) / 2));
        camera.position.copy(target).add(prev.position.clone().sub(target).setLength(d));
      }
      bridge.controls?.update();
    }
    previous.current = { camera, mode };
  }, [camera, mode, size.height]);

  useEffect(() => {
    if (!request || !bridge.controls) return;
    const controlsRef = bridge.controls;
    const all = currentObjects();
    const box = all.length ? worldBounds(all.filter((o) => o.parentId === null).map((o) => o.id), all) : new Box3(new Vector3(-60, -60, 0), new Vector3(60, 60, 40));
    const centre = box.isEmpty() ? new Vector3() : box.getCenter(new Vector3());
    const radius = box.isEmpty() ? 80 : Math.max(20, box.getSize(new Vector3()).length() / 2);
    const distance = radius / Math.sin(MathUtils.degToRad(45) / 2) * 1.1;
    const directions: Record<string, Vector3> = {
      home: HOME.clone().normalize(),
      fit: camera.position.clone().sub(controlsRef.target).normalize(),
      top: new Vector3(0, -0.0001, 1),
      front: new Vector3(0, -1, 0),
      right: new Vector3(1, 0, 0),
    };
    const target = request.preset === "home" && all.length === 0 ? new Vector3() : centre;
    controlsRef.target.copy(target);
    camera.position.copy(target).add(directions[request.preset]!.multiplyScalar(distance));
    if (camera instanceof OrthoCam) {
      camera.zoom = size.height / (2 * distance * Math.tan(MathUtils.degToRad(45) / 2));
      camera.updateProjectionMatrix();
    }
    controlsRef.update();
  }, [request]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

export function Viewport() {
  const objects = useProject((s) => s.project.document.workspaces.cad.objects as CadObject[]);
  const selection = useCad((s) => s.selection);
  const cameraMode = useCad((s) => s.camera);
  const selected = useMemo(() => new Set(selection), [selection]);
  const tool = useCad((s) => s.tool);
  const csgReady = useCad((s) => s.csgReady);
  const workplane = useCad((s) => s.workplane);
  // One list: holes are transparent, and three.js draws transparent objects after solid ones.
  // (Separate lists rebuilt a shape whenever it was switched between hole and solid.)
  const roots = objects.filter((o) => o.parentId === null);

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    // Files dragged in from the file manager.
    const files = [...e.dataTransfer.files].filter((f) => isModelFile(f.name));
    if (files.length) {
      e.preventDefault();
      void (async () => {
        const ids: string[] = [];
        for (const f of files) ids.push(...(await importModelFile(f.name, new Uint8Array(await f.arrayBuffer()))));
        if (ids.length) useCad.getState().select(ids);
      })();
      return;
    }
    const kind = e.dataTransfer.getData("application/x-makerstudio-shape") as PrimitiveKind;
    if (!PRIMITIVE_KINDS.includes(kind)) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const ndc = new Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const point = new Vector3();
    const workplane = useCad.getState().workplane;
    if (workplane) {
      // Drop onto the chosen face's plane.
      const plane = new Plane().setFromNormalAndCoplanarPoint(new Vector3(...workplane.normal), new Vector3(...workplane.origin));
      const ray = new Raycaster();
      if (bridge.camera) ray.setFromCamera(ndc, bridge.camera);
      const hit = bridge.camera ? ray.ray.intersectPlane(plane, point) : null;
      addPrimitive(kind, hit ? round3(point) : undefined);
      return;
    }
    if (bridge.camera) {
      const ray = new Raycaster();
      ray.setFromCamera(ndc, bridge.camera);
      if (!ray.ray.intersectPlane(new Plane(new Vector3(0, 0, 1), 0), point)) point.set(0, 0, 0);
    }
    const grid = useUi.getState().settings?.gridSize ?? 1;
    const snap = (v: number) => Math.round(v / grid) * grid;
    addPrimitive(kind, [snap(point.x), snap(point.y), 0]);
  };

  return (
    <div
      className={`viewport tool-${tool}`}
      data-testid="viewport"
      onDragOver={(e) => { if (e.dataTransfer.types.includes("application/x-makerstudio-shape") || e.dataTransfer.types.includes("Files")) e.preventDefault(); }}
      onDrop={onDrop}
    >
      {(tool !== "select" || !csgReady || workplane) && (
        <div className="viewport-hint" data-testid="viewport-hint">
          {!csgReady && <span>Loading the solid geometry engine…</span>}
          {tool === "measure" && <span>Measure: click two points on shapes or the bed. Esc to stop.</span>}
          {tool === "workplane" && <span>Workplane: click a face to build on it, or the bed to go back. Esc to cancel.</span>}
          {tool === "select" && workplane && (
            <span>New shapes go on the chosen face. <button className="link-btn" onClick={() => useCad.getState().setWorkplane(null)}>Back to the bed</button></span>
          )}
        </div>
      )}
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        onPointerMissed={(e) => {
          if (performance.now() - bridge.lastGizmoUse < 300) return; // a gizmo drag just ended
          if (!e.shiftKey && !e.ctrlKey) useCad.getState().select([]);
        }}
      >
        <color attach="background" args={["#101316"]} />
        <PerspectiveCamera makeDefault={cameraMode === "perspective"} position={HOME.toArray()} fov={45} near={0.5} far={20000} />
        <OrthographicCamera makeDefault={cameraMode === "orthographic"} position={HOME.toArray()} zoom={2.2} near={-20000} far={20000} />
        <OrbitControls makeDefault enableDamping={false} target={[0, 0, 0]} maxDistance={6000} />
        <CameraRig />
        <hemisphereLight args={["#dfe9f3", "#1b2026", 0.75]} />
        <directionalLight position={[120, -160, 260]} intensity={1.6} />
        <directionalLight position={[-150, 120, 80]} intensity={0.35} />
        <Bed />
        {roots.map((o) => <SceneNode key={o.id} object={o} all={objects} selection={selected} />)}
        <Gizmo />
        <PickPlane />
        <MeasureOverlay />
        <WorkplaneMarker />
        <PrintIssueOverlay />
        <GizmoHelper alignment="bottom-left" margin={[64, 64]}>
          <GizmoViewport axisColors={["#ff6b6b", "#2fd6a3", "#5aa9e6"]} labelColor="#0b0e10" />
        </GizmoHelper>
      </Canvas>
    </div>
  );
}
