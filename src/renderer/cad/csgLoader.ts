// Loads the WebAssembly solid-geometry engine once, at startup.
import Module from "manifold-3d/manifold";
import wasmUrl from "manifold-3d/manifold.wasm?url";
import { initCsg } from "../../core/cad/csg";
import { useUi } from "../state";
import { useCad } from "./cadState";

let started: Promise<void> | null = null;

export function loadCsg(): Promise<void> {
  started ??= initCsg(() => Module({ locateFile: () => wasmUrl }))
    .then(() => useCad.getState().setCsgReady(true))
    .catch((error) => {
      started = null;
      useUi.getState().notify("error", `The solid geometry engine could not load, so holes and Boolean operations are unavailable: ${error instanceof Error ? error.message : String(error)}`);
    });
  return started;
}
