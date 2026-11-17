---
id: three
reviewed_at: 2026-10-02
coverage: "Version-matched Three/Drei; R3F 8 with React 18 and 9 with React 19; Babylon by required capabilities"
---

# 3D when the experience benefits from a scene

- Three.js suits a custom scene. R3F is a React renderer for Three, not a competing
  engine; Drei offers optional helpers. Use them when React already fits. Astro
  can mount Three directly in the browser without adding React. Check Three,
  Fiber, Drei and React peers together; Fiber 8/9 target React 18/19 respectively,
  while Fiber 10 was alpha at review. [R3F compatibility](https://r3f.docs.pmnd.rs/getting-started/introduction),
  [Drei](https://github.com/pmndrs/drei).
- Babylon is worth evaluating when physics, collisions, XR or engine tooling
  are requirements. It is not automatically better for an existing decorative
  Three hero. WebGPU/WebGL support still needs browser/device detection and
  failure handling. [Babylon capabilities](https://www.babylonjs.com/specifications/).
- Load GPU/browser code at the appropriate client boundary, reserve stable canvas
  space and provide loading/error/no-GPU fallbacks. Essential information and
  actions must not depend exclusively on decorative canvas. Delay decorative
  resources when it protects the primary experience. [R3F Canvas](https://r3f.docs.pmnd.rs/api/canvas).
- Own the frame loop, controls, listeners, geometries, materials and textures.
  Removing a mesh does not dispose GPU resources. R3F automates much unmount
  disposal but primitives and shared objects need explicit ownership; never
  dispose a resource another scene uses. [Three disposal](https://threejs.org/manual/pages/how-to-dispose-of-objects.html),
  [R3F objects](https://r3f.docs.pmnd.rs/api/objects).
- Demand rendering suits idle scenes, not animation without invalidation. In
  R3F avoid state updates every frame; use refs/delta, reuse resources and consider
  instancing/adaptive quality from measurements. Do not cap quality by taste or
  force demand mode so a scene stops animating. [Scaling](https://r3f.docs.pmnd.rs/advanced/scaling-performance),
  [pitfalls](https://r3f.docs.pmnd.rs/advanced/pitfalls).

Verify navigation/unmount repeatedly, failed/slow asset load, absent GPU and
reduced-motion behavior without resource growth. Measure on target devices.
Three/R3F/Drei are MIT and Babylon Apache-2.0; models/textures/fonts carry their
own licenses. [Three](https://raw.githubusercontent.com/mrdoob/three.js/dev/LICENSE),
[R3F](https://raw.githubusercontent.com/pmndrs/react-three-fiber/master/LICENSE),
[Drei](https://raw.githubusercontent.com/pmndrs/drei/master/LICENSE),
[Babylon](https://raw.githubusercontent.com/BabylonJS/Babylon.js/master/license.md).
