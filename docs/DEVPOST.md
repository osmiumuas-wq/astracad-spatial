# Devpost submission copy — AstraCAD Spatial

Prepared from the repository and authenticated Devpost form on 16 Nov 2026. The project overview and story were saved in Devpost. Additional-info answers below are a draft and still need to be saved there. The entry was already marked SUBMITTED before these edits; do not click a submit/publish control without the entrant's review and explicit approval.

## Project title

AstraCAD Spatial

## Tagline

Hands-first mixed-reality CAD for parts that fit.

## Submission category and competition fields

- Track: Productivity
- Build path: IWSDK (Web XR)
- Competition release channel: https://osmiumuas-wq.github.io/astracad-spatial/
- Keep entrant identity, country, organization, and eligibility details in the live account; do not reproduce them in this public repository.
- The live form selected the New division. Confirm eligibility personally; repository history cannot establish whether work began earlier outside Git.

Check all eligibility attestations personally. The existing form had them checked; this document cannot attest to their truth.

## Inspiration

A replacement part usually starts with something physical: a phone that needs a stand, a broken knob, or a bracket that must fit a particular space. The usual workflow jumps between a ruler, desktop CAD, and repeated test prints. AstraCAD Spatial explores a more direct path: measure with tracked hands, shape a parametric part in a mixed-reality bench, and make the geometry check visible instead of asking people to trust a black box.

## What it does

AstraCAD Spatial is a browser-based, hands-first CAD workbench for Meta Quest. Users measure an object with finger-span or two-hand calipers, create a fitted cradle or a traced-footprint extrusion, then edit the resulting part with hand gestures, a feature ribbon, or voice commands. They can inspect the model at true 1:1 scale, zoom by voice or hand, and fit the current part to the bench view. A desktop browser provides a 2D editor as well.

The modeling engine builds triangle meshes in a Web Worker with the Manifold geometry kernel. For supported features, a closed-form truth gate compares the kernel result with an analytical volume and rejects an invalid build. Users can also run a voxel-based stress design preview, inspect rule-based engineering recommendations, and export printable STL or 3MF files, drawings, and STEP models. Additional tools include sketching, sheet metal, weldments, assemblies, and multi-user co-design.

This is a design tool, not a certified engineering or metrology system. Hand measurements are approximate and show their sample spread; stress results are previews. STEP editing is limited: imported blocks and cylinders can be recognized as parametric parts, while other imports remain reference geometry. The voice and hand interactions have been exercised in the IWSDK browser emulator; the project has not yet been verified on a physical Quest headset.

## How we built it

The app is a static TypeScript web application built with Meta's Immersive Web SDK (IWSDK) and WebXR. Modeling and analysis run in browser workers; the Manifold WebAssembly kernel builds the geometry, and a separate analytical truth gate checks supported operations. A shared application state drives the immersive bench and desktop editor, so edits and view controls do not need separate CAD implementations.

The feature set includes hand-tracked measuring and editing, spoken and typed commands, constrained sketches, STEP import/export, STL and 3MF export, a voxel finite-element stress preview, rule-based design agents, and browser-to-browser co-design. Tests cover geometry, command parsing, exports, and solver comparisons. The project runs without its own application server; optional co-design uses a public PeerJS signalling broker. Speech recognition and some language-model assets are downloaded by the browser when first used. The production build includes a service worker that precaches the core shell; offline reload has not been verified.

The recent fit-view addition computes a view zoom from the current verified model bounds. It changes only the bench presentation—not the part's dimensions—and reports when a model is too large to fit at the supported zoom limit.

## Challenges we ran into

The hardest challenge was making a browser CAD kernel useful without hiding geometry errors. Mesh volume alone is not enough to establish that a part is correct, so supported modeling operations are checked against closed-form results before they are accepted. The stress preview also needed careful grid sizing: cells that cut across thin walls made parts appear artificially stiff. We adjusted the grid alignment and compared a wall-bracket case against CalculiX. Another challenge is setting honest expectations for hand tracking: a fine editing increment is not the same thing as measurement accuracy, so the app reports measurement spread instead of promising precision the headset cannot provide.

## Accomplishments that we're proud of

- A complete browser-based CAD loop from measuring and shaping through validation and export.
- A truth gate that rejects unsupported or inconsistent geometry rather than silently accepting it.
- Hands-first interaction with keyboard, pointer, typed-command, and voice alternatives.
- A stress preview checked against beam theory and a CalculiX reference case.
- A usable feature-rich editor that also opens in a standard desktop browser.
- Automated verification on this branch: typecheck and production build passed. The latest full test run had 247 passed, 2 skipped, and one time-threshold failure in `tests/round.test.ts` (14.46 s vs 10 s); another full run measured 12.33 s, and a targeted rerun measured 10.67 s. Do not describe the full suite as passing.

## What we learned

A mixed-reality interface does not make an unreliable measurement precise. The useful design is to show uncertainty and let users calibrate, while keeping exact numeric input available for dimensions. We also learned that physical correctness and usability require different evidence: automated geometry tests can verify the kernel, and an emulator can exercise interactions, but neither substitutes for performance and comfort testing on the actual headset.

## What's next

Test the current build on Quest 3/3S, including hand tracking, voice latency, comfort, and performance; publish the new fit-view change to the public demo; then prioritize improvements based on device testing. Larger future work includes more complete feature recognition for imported STEP models, better stress convergence for concentrated loads, and a carefully scoped printer workflow. These are not presented as completed features.

## Built with

TypeScript, Meta Immersive Web SDK (IWSDK), WebXR, Manifold, WebAssembly, Three.js, planeGCS, OpenCascade (`occt-import-js`), transformers.js, ONNX Runtime Web, PeerJS, Vite, Vitest.

## Demo URL

https://osmiumuas-wq.github.io/astracad-spatial/

## Source code URL

https://github.com/osmiumuas-wq/astracad-spatial

## Meta VR capabilities (additional-info field)

AstraCAD Spatial is a WebXR CAD application built with Meta's Immersive Web SDK. In immersive mode it uses tracked hand input and hand-joint positions for measurement and interaction, WebXR plane information for tabletop placement, hit testing for spatial measurement, and session anchors to help stabilize the bench. IWSDK's depth-sensing system can provide optional occlusion and clash visualization when the runtime supplies depth data. The app also supports hand-ray and dwell-based UI selection, with controller and desktop pointer alternatives. These capabilities are runtime-dependent: interaction footage was captured in the IWSDK/IWER browser emulator, and the app has not been tested on a physical Quest headset. We do not claim Quest microgesture support or persistent room anchors.

## Hand interactions (additional-info field)

Hand joints drive the measuring tools and spatial interactions. Users pinch across an object for a finger-span reading or between two hands for a tape measurement; the app reports sample spread and supports per-method calibration. In Shape mode, users pinch and pull dimension handles, turn a dial, and manipulate the bench. A flat-hand gesture can slice a part, and an open-palm push can apply a load for a stress design preview. Buttons can be selected with a hand ray; typed commands and voice are alternative inputs. These interaction paths were exercised in the browser XR emulator; physical Quest tracking and comfort have not yet been tested.

## What makes you excited about the future of VR? (additional-info field)

VR is exciting because it can put design tools in the same space as the objects they describe. A designer can compare a part to a real object, understand its scale, and collaborate around a shared spatial model instead of translating everything through a flat screen. The opportunity is not just immersion: it is making complex tools more tangible and accessible. I’m especially interested in browser-based XR, where people can try a spatial workflow without installing a native app. The next step is to keep that promise grounded in real-world testing, clear uncertainty, and comfortable interactions.

## Demo video

The existing project page had a video and twelve photo captions. The repository's candidate is `artifacts/video/astracad-spatial-cut-small.mp4`; confirm it is the intended final cut and plays under the event's duration limit. The footage was recorded in the IWSDK/IWER emulator on a PC, not on a physical headset. Preserve that disclosure in the video description or project text.

## Before saving the live form

- Devpost is signed in. The overview/story edits were saved; the additional-info edits are not confirmed saved because the browser session stopped responding.
- Confirm the entry's project origin and eligibility details personally. Repository history is not proof that no earlier work exists elsewhere.
- The existing project page has a video and twelve photo captions. Review the live demo and media; the fit-view feature in this branch is not deployed to the public demo URL.
- Verify contact details in the live form personally before changing them; this draft does not reproduce account contact information.
- Review all fields, especially the Meta capability claims and legal attestations. Save the draft only after review. Do not publish/submit until the entrant has reviewed and explicitly approved the final form.
