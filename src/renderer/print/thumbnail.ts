// Pictures of the parts for the printer's screen (its file list shows them). Bambu Studio's
// command-line slicer cannot draw them on computers without OSMesa, so they are drawn here.

import { AmbientLight, Box3, BufferAttribute, BufferGeometry, DirectionalLight, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from "three";
import type { ExportPart } from "../../core/cad/exporting";

const LARGE = 512;
const SMALL = 128;

function toPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error("no picture"));
      blob.arrayBuffer().then((b) => resolve(new Uint8Array(b)), reject);
    }, "image/png");
  });
}

/** Draws the parts from the front-right, like the slicer's plate pictures. Null when drawing is not possible. */
export async function renderThumbnails(parts: ExportPart[], colorOf: (part: ExportPart) => string): Promise<{ large: Uint8Array; small: Uint8Array } | null> {
  if (parts.length === 0) return null;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = LARGE;
  let renderer: WebGLRenderer | null = null;
  const disposables: { dispose(): void }[] = [];
  try {
    renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setClearColor(0x000000, 0);
    const scene = new Scene();
    scene.add(new AmbientLight(0xffffff, 0.9));
    const key = new DirectionalLight(0xffffff, 1.8);
    key.position.set(1, -1.6, 2.2);
    scene.add(key);
    const fill = new DirectionalLight(0xffffff, 0.5);
    fill.position.set(-2, 1, 0.5);
    scene.add(fill);
    const box = new Box3();
    for (const part of parts) {
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new BufferAttribute(part.positions, 3));
      geometry.setIndex(new BufferAttribute(part.indices, 1));
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      box.union(geometry.boundingBox!);
      const material = new MeshStandardMaterial({ color: colorOf(part), roughness: 0.55, metalness: 0.05 });
      disposables.push(geometry, material);
      scene.add(new Mesh(geometry, material));
    }
    const centre = box.getCenter(new Vector3());
    const radius = Math.max(box.getSize(new Vector3()).length() / 2, 1);
    const camera = new PerspectiveCamera(30, 1, radius / 100, radius * 20);
    const distance = radius / Math.sin((30 / 2) * (Math.PI / 180));
    camera.up.set(0, 0, 1);
    camera.position.copy(centre).add(new Vector3(0.9, -1.4, 1.0).normalize().multiplyScalar(distance * 1.02));
    camera.lookAt(centre);
    renderer.render(scene, camera);
    const large = await toPng(canvas);
    const small = document.createElement("canvas");
    small.width = small.height = SMALL;
    small.getContext("2d")!.drawImage(canvas, 0, 0, SMALL, SMALL);
    return { large, small: await toPng(small) };
  } catch {
    return null;
  } finally {
    for (const d of disposables) d.dispose();
    renderer?.dispose();
    renderer?.forceContextLoss();
  }
}
