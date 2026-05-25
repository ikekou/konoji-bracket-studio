import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js";

const MATERIAL_COLOR = 0xd9d2c4;
const EDGE_COLOR = 0x4b5563;
const DIMENSION_COLOR = 0x1d4ed8;

function createTextSprite(text, color = "#111827") {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const fontSize = 40;
  context.font = `${fontSize}px Inter, system-ui, sans-serif`;
  const metrics = context.measureText(text);
  canvas.width = Math.ceil(metrics.width + 32);
  canvas.height = 64;
  context.font = `${fontSize}px Inter, system-ui, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "rgba(247, 249, 251, 0.92)";
  context.fillRect(0, 8, canvas.width, 48);
  context.fillStyle = color;
  context.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(canvas.width * 0.045, canvas.height * 0.045, 1);
  sprite.userData.texture = texture;
  return sprite;
}

function disposeObject(object) {
  object.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        if (material.map) material.map.dispose();
        material.dispose();
      });
    }
    if (child.userData?.texture) child.userData.texture.dispose();
  });
}

function createDimensionLine(a, b, label, color = DIMENSION_COLOR) {
  const group = new THREE.Group();
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(...a),
    new THREE.Vector3(...b),
  ]);
  const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, depthTest: false }));
  line.renderOrder = 2;
  group.add(line);

  const sprite = createTextSprite(label, color === DIMENSION_COLOR ? "#1d4ed8" : "#111827");
  sprite.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  sprite.renderOrder = 3;
  group.add(sprite);
  return group;
}

function buildGeometry(triangles) {
  const positions = [];
  for (const tri of triangles) {
    for (const vertex of tri) positions.push(vertex[0], vertex[1], vertex[2]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function getModelRadius(mesh, dimensionSegments) {
  const points = mesh.faces.flat();
  dimensionSegments.forEach(({ a, b }) => points.push(a, b));
  return points.reduce((max, point) => Math.max(max, Math.hypot(point[0], point[1], point[2])), 1);
}

function createPreview(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 2000);
  const modelGroup = new THREE.Group();
  const dimensionGroup = new THREE.Group();
  scene.add(modelGroup, dimensionGroup);

  scene.add(new THREE.AmbientLight(0xffffff, 1.9));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.7);
  keyLight.position.set(-60, 80, 90);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0xbfd7ff, 1.2);
  fillLight.position.set(90, -30, -70);
  scene.add(fillLight);

  function resize() {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function render() {
    resize();
    renderer.render(scene, camera);
  }

  function update(mesh, view, dimensionSegments) {
    disposeObject(modelGroup);
    disposeObject(dimensionGroup);
    modelGroup.clear();
    dimensionGroup.clear();

    const geometry = buildGeometry(mesh.triangles);
    const material = new THREE.MeshStandardMaterial({
      color: MATERIAL_COLOR,
      roughness: 0.58,
      metalness: 0.08,
      side: THREE.DoubleSide,
    });
    const solid = new THREE.Mesh(geometry, material);
    modelGroup.add(solid);

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry, 28),
      new THREE.LineBasicMaterial({ color: EDGE_COLOR, transparent: true, opacity: 0.36 }),
    );
    modelGroup.add(edges);

    if (view.showDims) {
      dimensionSegments.forEach(({ a, b, label, color }) => {
        dimensionGroup.add(createDimensionLine(a, b, label, color === "#1d4ed8" ? DIMENSION_COLOR : 0x111827));
      });
    }

    const radius = getModelRadius(mesh, dimensionSegments);
    const distance = radius * (2.9 / view.zoom);
    camera.position.set(0, 0, distance);
    camera.near = Math.max(0.1, distance - radius * 4);
    camera.far = distance + radius * 4;
    camera.updateProjectionMatrix();
    modelGroup.rotation.set(view.rotX, view.rotY, 0);
    dimensionGroup.rotation.copy(modelGroup.rotation);
    render();
  }

  function destroy() {
    disposeObject(modelGroup);
    disposeObject(dimensionGroup);
    renderer.dispose();
  }

  return { update, resize: render, destroy };
}

window.KonojiPreview3D = { createPreview };
window.dispatchEvent(new CustomEvent("konoji-preview-ready"));
