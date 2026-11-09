// Binary encoding of imported meshes (no other dependencies, so the desktop process
// can check project files without loading the 3D libraries). Layout is described in meshes.ts.

export interface MeshData {
  positions: Float32Array;
  indices: Uint32Array;
}

const MAGIC = "MSMESH01";
export const MAX_TRIANGLES = 5_000_000;

export function encodeMesh(mesh: MeshData): Uint8Array {
  const vertexCount = mesh.positions.length / 3;
  const triangleCount = mesh.indices.length / 3;
  const bytes = new Uint8Array(16 + mesh.positions.byteLength + mesh.indices.byteLength);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < 8; i++) bytes[i] = MAGIC.charCodeAt(i);
  view.setUint32(8, vertexCount, true);
  view.setUint32(12, triangleCount, true);
  let offset = 16;
  for (const v of mesh.positions) { view.setFloat32(offset, v, true); offset += 4; }
  for (const i of mesh.indices) { view.setUint32(offset, i, true); offset += 4; }
  return bytes;
}

export function decodeMesh(bytes: Uint8Array): MeshData {
  if (bytes.length < 16) throw new Error("Mesh data is too short.");
  for (let i = 0; i < 8; i++) if (bytes[i] !== MAGIC.charCodeAt(i)) throw new Error("Mesh data has an unknown format.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const vertexCount = view.getUint32(8, true);
  const triangleCount = view.getUint32(12, true);
  if (triangleCount > MAX_TRIANGLES) throw new Error("Mesh has too many triangles.");
  if (bytes.length !== 16 + vertexCount * 12 + triangleCount * 12) throw new Error("Mesh data has the wrong length.");
  const positions = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(triangleCount * 3);
  let offset = 16;
  for (let i = 0; i < positions.length; i++) {
    const v = view.getFloat32(offset, true);
    if (!Number.isFinite(v)) throw new Error("Mesh data contains an invalid number.");
    positions[i] = v;
    offset += 4;
  }
  for (let i = 0; i < indices.length; i++) {
    const index = view.getUint32(offset, true);
    if (index >= vertexCount) throw new Error("Mesh data refers to a vertex that does not exist.");
    indices[i] = index;
    offset += 4;
  }
  return { positions, indices };
}
