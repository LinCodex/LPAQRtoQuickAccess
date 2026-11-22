import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export type Angle = 'front' | 'angle' | 'rear';
export type ProductViewer = { ready: Promise<void>; setAngle: (angle: Angle) => void; destroy: () => void };

function disposeModel(group: THREE.Object3D) {
  const textures = new Set<THREE.Texture>();
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        for (const v of Object.values(m)) {
          if (v instanceof THREE.Texture) textures.add(v);
        }
        m.dispose();
      }
    }
  });
  for (const t of textures) {
    t.dispose();
    if (t.source.data instanceof ImageBitmap) t.source.data.close();
  }
}

export function createProductViewer(
  canvas: HTMLCanvasElement,
  url: string,
  onReady: () => void,
  onUnavailable: () => void = () => {}
): ProductViewer {
  // Keep depth precision around the actual 16cm product, so its display and
  // glass layers remain distinct even when viewed straight on.
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 2);
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.8;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, 0.04);
  scene.environment = environment.texture;
  room.dispose();
  pmrem.dispose();

  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = false;
  controls.enableZoom = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.13;
  controls.rotateSpeed = 0.65;

  const abort = new AbortController();
  let disposed = false;
  let frame = 0;
  let model: THREE.Group | undefined;
  let radius = 0.37;
  let angle: Angle = 'angle';
  let tween: { start: number; from: THREE.Spherical; to: THREE.Spherical } | undefined;

  const direction = (a: Angle) =>
    new THREE.Vector3(...(a === 'front' ? [0, 0, 1] : a === 'rear' ? [-0.25, 0.13, -1] : [0.4, 0.2, 1]))
      .normalize()
      .multiplyScalar(radius);

  function schedule() {
    if (!disposed && !frame) frame = requestAnimationFrame(draw);
  }

  function draw(now: number) {
    frame = 0;
    if (disposed) return;
    let moving = false;
    if (tween) {
      const t = Math.min(1, (now - tween.start) / 650);
      const p = t * t * (3 - 2 * t);
      camera.position.setFromSpherical(
        new THREE.Spherical(
          radius,
          THREE.MathUtils.lerp(tween.from.phi, tween.to.phi, p),
          THREE.MathUtils.lerp(tween.from.theta, tween.to.theta, p)
        )
      );
      if (t === 1) tween = undefined;
      else moving = true;
    }
    const changed = controls.update();
    renderer.render(scene, camera);
    if (moving || changed) schedule();
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / Math.max(1, r.height);
    radius = (0.19 / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)))) * Math.max(1, 0.62 / camera.aspect);
    camera.position.copy(direction(angle));
    camera.updateProjectionMatrix();
    schedule();
  }

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  controls.addEventListener('change', schedule);
  controls.addEventListener('start', () => {
    tween = undefined;
  });

  canvas.addEventListener(
    'keydown',
    (e) => {
      if (!model) return;
      const step = 0.2;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        tween = undefined;
        const spherical = new THREE.Spherical().setFromVector3(camera.position);
        if (e.key === 'ArrowLeft') spherical.theta += step;
        if (e.key === 'ArrowRight') spherical.theta -= step;
        if (e.key === 'ArrowUp') spherical.phi = Math.max(0.25, spherical.phi - step * 0.7);
        if (e.key === 'ArrowDown') spherical.phi = Math.min(Math.PI - 0.25, spherical.phi + step * 0.7);
        camera.position.setFromSpherical(spherical);
        controls.update();
        schedule();
      }
    },
    { signal: abort.signal }
  );

  canvas.addEventListener(
    'webglcontextlost',
    (e) => {
      e.preventDefault();
      canvas.style.opacity = '0';
      cancelAnimationFrame(frame);
      frame = 0;
      onUnavailable();
    },
    { signal: abort.signal }
  );

  const ready = (async () => {
    const response = await fetch(url, { signal: abort.signal });
    if (!response.ok) throw Error('Model unavailable');
    const data = await response.arrayBuffer();
    if (disposed) return;
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(data, '');
    if (disposed) {
      disposeModel(gltf.scene);
      return;
    }
    model = gltf.scene;
    const center = new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3());
    model.position.sub(center);
    scene.add(model);
    resize();
    renderer.render(scene, camera);
    onReady();
  })();

  return {
    ready,
    setAngle(a) {
      angle = a;
      if (disposed || !model) return;
      tween = undefined;
      controls.update();
      const to = direction(a);
      if (matchMedia('(prefers-reduced-motion:reduce)').matches) {
        camera.position.copy(to);
      } else {
        const from = new THREE.Spherical().setFromVector3(camera.position);
        const target = new THREE.Spherical().setFromVector3(to);
        target.theta =
          from.theta + THREE.MathUtils.euclideanModulo(target.theta - from.theta + Math.PI, Math.PI * 2) - Math.PI;
        tween = { start: performance.now(), from, to: target };
      }
      schedule();
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      abort.abort();
      observer.disconnect();
      cancelAnimationFrame(frame);
      controls.dispose();
      if (model) disposeModel(model);
      environment.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.style.opacity = '0';
    }
  };
}
