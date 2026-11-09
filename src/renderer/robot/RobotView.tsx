// 3D view of the robot in a pose: parts moved by their joints, joint markers, and mounted
// screens showing their live faces.

import { Line, OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { BufferAttribute, BufferGeometry, DataTexture, Matrix4, NearestFilter, Object3D, RGBAFormat, SRGBColorSpace, Vector3 } from "three";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { solidMesh } from "../../core/cad/csg";
import { buildGeometry, localMatrix } from "../../core/cad/geometry";
import type { CadObject } from "../../core/cad/model";
import { displayById } from "../../core/display/catalog";
import { faceOps, rasterize, type FaceState, type Screen } from "../../core/display/face";
import { axisVector, type Robot, type ScreenMount } from "../../core/robot/model";
import { Bed } from "../cad/Viewport";
import { sharedMeshGeometry } from "../cad/meshDisplay";

Object3D.DEFAULT_UP.set(0, 0, 1);

export type PickMode = null | "pivot" | "screen";

export interface PickHit { objectId: string; point: [number, number, number]; normal: [number, number, number] }

function Part({ object, all, matrix, selected, onPick }: {
  object: CadObject; all: CadObject[]; matrix: Matrix4; selected: boolean; onPick(hit: PickHit, e: ThreeEvent<MouseEvent>): void;
}) {
  // Imported meshes are shown as they are (the same shared geometry as 3D Studio, built once):
  // running a big figure through the solid engine only to draw it took seconds.
  const shared = object.kind === "mesh";
  const geometry = useMemo(() => {
    if (shared) return sharedMeshGeometry(object);
    let mesh;
    try {
      mesh = solidMesh(object, all);
    } catch {
      // Not a closed solid (a group holding an open mesh, from an older file): show the shape as it is.
      return buildGeometry(object);
    }
    if (mesh.empty) return null;
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(mesh.positions, 3));
    g.setIndex(new BufferAttribute(mesh.indices, 1));
    return toCreasedNormals(g, Math.PI / 6);
  }, [object, all, shared]);
  useEffect(() => () => { if (!shared) geometry?.dispose(); }, [geometry, shared]);
  if (!geometry) return null;
  return (
    <mesh
      geometry={geometry}
      dispose={null}
      matrixAutoUpdate={false}
      matrix={matrix}
      onClick={(e) => {
        e.stopPropagation();
        const n = e.face ? e.face.normal.clone().transformDirection(e.object.matrixWorld) : new Vector3(0, 0, 1);
        onPick({ objectId: object.id, point: e.point.toArray() as [number, number, number], normal: n.toArray() as [number, number, number] }, e);
      }}
      data-object={object.id}
    >
      <meshStandardMaterial color={object.color} roughness={0.55} metalness={0.05} emissive={selected ? "#1b6b55" : "#000000"} emissiveIntensity={selected ? 0.5 : 0} />
    </mesh>
  );
}

/** A Display Studio face shown on the robot, as a flat panel that follows its part. */
function MountedScreen({ mount, screen, state, delta, selected }: { mount: ScreenMount; screen: Screen; state: FaceState; delta: Matrix4; selected: boolean }) {
  const display = displayById(screen.display);
  const texture = useMemo(() => {
    if (!display) return null;
    const t = new DataTexture(new Uint8Array(display.width * display.height * 4), display.width, display.height, RGBAFormat);
    t.magFilter = NearestFilter;
    t.minFilter = NearestFilter;
    t.colorSpace = SRGBColorSpace;
    return t;
  }, [display]);
  useEffect(() => () => texture?.dispose(), [texture]);
  useEffect(() => {
    if (!display || !texture) return;
    const px = rasterize(faceOps(screen.face, display, state), display);
    const data = texture.image.data as Uint8Array;
    // Image rows run top to bottom; texture rows bottom to top.
    const row = display.width * 4;
    for (let y = 0; y < display.height; y++) data.set(px.subarray(y * row, (y + 1) * row), (display.height - 1 - y) * row);
    texture.needsUpdate = true;
  }, [screen.face, display, state, texture]);
  const matrix = useMemo(() => {
    const n = new Vector3(...mount.normal).normalize();
    const worldUp = Math.abs(n.z) > 0.9 ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1);
    const up = worldUp.sub(n.clone().multiplyScalar(worldUp.dot(n))).normalize();
    const right = new Vector3().crossVectors(up, n);
    const pos = new Vector3(...mount.position).addScaledVector(n, 0.3);
    return delta.clone().multiply(new Matrix4().makeBasis(right, up, n).setPosition(pos));
  }, [mount, delta]);
  if (!display || !texture) return null;
  const height = (mount.width * display.height) / display.width;
  return (
    <group matrixAutoUpdate={false} matrix={matrix}>
      <mesh raycast={() => null}>
        <planeGeometry args={[mount.width, height]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
      {selected && (
        <Line points={[[-mount.width / 2 - 1, -height / 2 - 1, 0.1], [mount.width / 2 + 1, -height / 2 - 1, 0.1], [mount.width / 2 + 1, height / 2 + 1, 0.1], [-mount.width / 2 - 1, height / 2 + 1, 0.1], [-mount.width / 2 - 1, -height / 2 - 1, 0.1]]} color="#f2b84b" lineWidth={2} />
      )}
    </group>
  );
}

function JointMarker({ robot, jointId, deltas, selected }: { robot: Robot; jointId: string; deltas: Map<string, Matrix4>; selected: boolean }) {
  const joint = robot.joints.find((j) => j.id === jointId)!;
  const frame = joint.parent ? deltas.get(joint.parent) ?? new Matrix4() : new Matrix4();
  const p = new Vector3(...joint.pivot).applyMatrix4(frame);
  const a = axisVector(joint.axis).transformDirection(frame).multiplyScalar(18);
  const color = selected ? "#f2b84b" : "#22b8c9";
  return (
    <group>
      <mesh position={p} raycast={() => null}>
        <sphereGeometry args={[selected ? 2.2 : 1.6, 16, 12]} />
        <meshBasicMaterial color={color} depthTest={false} transparent opacity={0.9} />
      </mesh>
      <Line points={[p.clone().sub(a).toArray(), p.clone().add(a).toArray()]} color={color} lineWidth={selected ? 3 : 2} depthTest={false} transparent />
    </group>
  );
}

export function RobotView({ objects, robot, deltas, screens, faceState, selectedPart, selectedJoint, selectedMount, pickMode, onPick, onMiss }: {
  objects: CadObject[];
  robot: Robot | null;
  deltas: Map<string, Matrix4>;
  screens: Screen[];
  faceState: FaceState;
  selectedPart: string | null;
  selectedJoint: string | null;
  selectedMount: string | null;
  pickMode: PickMode;
  onPick(hit: PickHit): void;
  onMiss(): void;
}) {
  const parts = objects.filter((o) => o.parentId === null && o.visible && !o.hole);
  return (
    <Canvas dpr={[1, 2]} gl={{ antialias: true, preserveDrawingBuffer: true }} onPointerMissed={onMiss} style={{ cursor: pickMode ? "crosshair" : "default" }} data-testid="robot-canvas">
      <color attach="background" args={["#101316"]} />
      <PerspectiveCamera makeDefault position={[160, -220, 170]} fov={40} near={0.5} far={20000} />
      <OrbitControls makeDefault enableDamping={false} target={[0, 0, 40]} />
      <hemisphereLight args={["#dfe9f3", "#1b2026", 0.8]} />
      <directionalLight position={[120, -160, 260]} intensity={1.6} />
      <directionalLight position={[-150, 120, 80]} intensity={0.35} />
      <Bed />
      {parts.map((o) => {
        const m = (deltas.get(o.id) ?? new Matrix4()).clone().multiply(localMatrix(o.transform));
        return <Part key={o.id} object={o} all={objects} matrix={m} selected={o.id === selectedPart} onPick={(hit) => onPick(hit)} />;
      })}
      {robot?.mounts.map((m) => {
        const screen = screens.find((s) => s.id === m.screenId);
        return screen ? <MountedScreen key={m.id} mount={m} screen={screen} state={faceState} delta={deltas.get(m.objectId) ?? new Matrix4()} selected={m.id === selectedMount} /> : null;
      })}
      {robot?.joints.map((j) => <JointMarker key={j.id} robot={robot} jointId={j.id} deltas={deltas} selected={j.id === selectedJoint} />)}
    </Canvas>
  );
}
