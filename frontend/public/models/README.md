# Face-detection model files (swap-in path)

This directory is the documented home for client-side face-detection weights
(e.g. face-api.js `tiny_face_detector_model-*` / `face_landmark_68_model-*`,
or MediaPipe task bundles). Files placed here are served statically —
Vercel hosts everything under `frontend/public/` at the site root, so a
model at `public/models/tiny_face_detector_model-weights_manifest.json`
loads from the relative URL `models/tiny_face_detector_model-...`
with no code change between localhost and production.

Status: **no weights are bundled yet, by design.** The proctoring sensors
(`src/features/proctoring/sensors.js`) currently monitor stream health,
tab/fullscreen/clipboard/devtools signals, and optional mic level, and every
sensor funnels through the single `flagEmitter` — real in-browser CV is the
documented swap-in at `useFaceCheck`, kept out of the bundle per the tech
lock (no new heavy dependency without owner approval). The webcam itself
needs no model files: `getUserMedia` works on localhost and on Vercel
(HTTPS) as-is.

To enable real face detection later:
1. Drop the weight files into this `models/` directory.
2. Load them with a relative base path, e.g.
   `faceapi.nets.tinyFaceDetector.loadFromUri('models')`
   (relative — never an absolute localhost URL).
3. Keep the sensor behind the existing `flagEmitter` + cooldowns, and keep
   sending thumbnails only (NFR-10: never continuous video).
