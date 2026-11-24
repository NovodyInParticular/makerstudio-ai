// The sliced layers in the 3D view: one line set per feature type (walls, infill, supports…),
// each drawn up to the chosen layer with a draw range, so moving the slider costs nothing.

import { useEffect, useLayoutEffect, useMemo } from "react";
import { BufferAttribute, BufferGeometry, Color, LineBasicMaterial } from "three";
import { featureStyle } from "../../core/print/gcode";
import { useSlice } from "./slicing";

export function ToolpathPreview() {
  const preview = useSlice((s) => s.preview);
  const layer = useSlice((s) => s.layer);
  const hidden = useSlice((s) => s.hidden);
  const cx = useSlice((s) => s.outcome?.bedCentre[0] ?? 128);
  const cy = useSlice((s) => s.outcome?.bedCentre[1] ?? 128);

  const sets = useMemo(() => (preview?.features ?? []).map((f) => {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(f.positions, 3));
    const style = featureStyle(f.name);
    // The layer being looked at is drawn lighter, so it stands out from the ones below.
    const top = new BufferGeometry();
    top.setAttribute("position", geometry.getAttribute("position"));
    const topColor = new Color(style.color).lerp(new Color("#ffffff"), 0.45);
    return { f, geometry, top, material: new LineBasicMaterial({ color: style.color }), topMaterial: new LineBasicMaterial({ color: topColor }) };
  }), [preview]);

  useEffect(() => () => {
    for (const s of sets) { s.geometry.dispose(); s.top.dispose(); s.material.dispose(); s.topMaterial.dispose(); }
  }, [sets]);

  useLayoutEffect(() => {
    for (const s of sets) {
      const end = s.f.layerEnds[Math.min(layer, s.f.layerEnds.length - 1)] ?? 0;
      const start = layer > 0 ? s.f.layerEnds[Math.min(layer - 1, s.f.layerEnds.length - 1)] ?? 0 : 0;
      s.geometry.setDrawRange(0, start * 2);
      s.top.setDrawRange(start * 2, (end - start) * 2);
    }
  }, [sets, layer]);

  if (!preview) return null;
  return (
    <group position={[-cx, -cy, 0]}>
      {sets.map((s) => hidden.includes(s.f.name) ? null : (
        <group key={s.f.name}>
          <lineSegments geometry={s.geometry} material={s.material} frustumCulled={false} />
          <lineSegments geometry={s.top} material={s.topMaterial} frustumCulled={false} renderOrder={1} />
        </group>
      ))}
    </group>
  );
}

/** The slider and banner shown over the 3D view while the layers are on. */
export function LayerSlider() {
  const preview = useSlice((s) => s.preview);
  const layer = useSlice((s) => s.layer);
  const set = useSlice((s) => s.set);
  if (!preview || preview.layerCount === 0) return null;
  const z = preview.layerZ[layer] ?? 0;
  const last = preview.layerCount - 1;
  return (
    <>
      <div className="layer-slider" data-testid="layer-slider">
        <span className="layer-top">{preview.layerCount}</span>
        <input
          type="range"
          min={0}
          max={last}
          value={layer}
          aria-label="Layer"
          onChange={(e) => set({ layer: Number(e.target.value) })}
          data-testid="layer-range"
        />
        <span className="layer-bottom">1</span>
      </div>
      <div className="viewport-hint layer-hint" data-testid="layer-hint">
        <span>Layer <b>{layer + 1}</b> of {preview.layerCount} · {z.toFixed(2)} mm</span>
        <button className="link-btn" onClick={() => set({ layer: Math.max(0, layer - 1) })} aria-label="One layer down">▼</button>
        <button className="link-btn" onClick={() => set({ layer: Math.min(last, layer + 1) })} aria-label="One layer up">▲</button>
        <button className="link-btn" onClick={() => set({ previewOn: false })} data-testid="layer-back">Back to my model</button>
      </div>
    </>
  );
}
