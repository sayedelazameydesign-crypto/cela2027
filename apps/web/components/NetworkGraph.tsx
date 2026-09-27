'use client';

/**
 * Cela 2027 — 3D pipeline network (Three.js)
 * Glowing agent-pipeline nodes: الهدف ← الخطة ← السياسة ← التنفيذ ← التحقق ← الأدلة
 * The active node pulses; failures flash red. Pure visual — no app logic.
 */

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

export type PipelineId =
  | 'goal'
  | 'plan'
  | 'policy'
  | 'execute'
  | 'verify'
  | 'evidence';

interface NodeSpec {
  id: PipelineId;
  label: string;
  color: number;
  position: [number, number, number];
}

const PIPELINE: NodeSpec[] = [
  { id: 'goal', label: 'الهدف', color: 0xff6b35, position: [-95, 18, 0] },
  { id: 'plan', label: 'الخطة', color: 0x00d4ff, position: [-48, -24, 14] },
  { id: 'policy', label: 'السياسة', color: 0xa78bfa, position: [0, 26, -12] },
  { id: 'execute', label: 'التنفيذ', color: 0xff9500, position: [48, -22, 10] },
  { id: 'verify', label: 'التحقق', color: 0x38bdf8, position: [92, 22, 0] },
  { id: 'evidence', label: 'الأدلة', color: 0xffd700, position: [0, -8, 58] },
];

const EDGES: Array<[PipelineId, PipelineId]> = [
  ['goal', 'plan'],
  ['plan', 'policy'],
  ['policy', 'execute'],
  ['execute', 'verify'],
  ['verify', 'evidence'],
  ['evidence', 'goal'],
];

function makeLabel(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'bold 42px Tahoma, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(186, 245, 255, 0.95)';
  ctx.shadowColor = 'rgba(34, 211, 238, 0.9)';
  ctx.shadowBlur = 14;
  ctx.fillText(text, 128, 48);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(44, 16.5, 1);
  return sprite;
}

export default function NetworkGraph({
  active,
  failed,
}: {
  active: PipelineId | null;
  failed: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<{ active: PipelineId | null; failed: boolean }>({
    active: null,
    failed: false,
  });

  useEffect(() => {
    stateRef.current = { active, failed };
  }, [active, failed]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x050816, 180, 460);

    const camera = new THREE.PerspectiveCamera(
      60,
      container.clientWidth / Math.max(container.clientHeight, 1),
      0.1,
      1200
    );
    camera.position.set(0, 12, 175);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const key = new THREE.PointLight(0x22d3ee, 2.2, 700);
    key.position.set(90, 100, 130);
    scene.add(key);
    const fill = new THREE.PointLight(0x3b82f6, 1.4, 700);
    fill.position.set(-110, -70, 90);
    scene.add(fill);

    const group = new THREE.Group();
    scene.add(group);

    const specById = new Map(PIPELINE.map((n) => [n.id, n]));

    const edgesMat = new THREE.LineBasicMaterial({
      color: 0x22d3ee,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
    });
    for (const [a, b] of EDGES) {
      const na = specById.get(a)!;
      const nb = specById.get(b)!;
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(...na.position),
        new THREE.Vector3(...nb.position),
      ]);
      group.add(new THREE.Line(geo, edgesMat));
    }

    const nodeMeshes = new Map<PipelineId, THREE.Mesh>();
    const baseColors = new Map<PipelineId, THREE.Color>();
    for (const spec of PIPELINE) {
      const geo = new THREE.IcosahedronGeometry(11, 2);
      const mat = new THREE.MeshStandardMaterial({
        color: spec.color,
        emissive: spec.color,
        emissiveIntensity: 0.3,
        metalness: 0.75,
        roughness: 0.25,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(...spec.position);
      group.add(mesh);
      nodeMeshes.set(spec.id, mesh);
      baseColors.set(spec.id, new THREE.Color(spec.color));

      const nodeLight = new THREE.PointLight(spec.color, 0.7, 130);
      nodeLight.position.copy(mesh.position);
      group.add(nodeLight);

      const label = makeLabel(spec.label);
      label.position.set(spec.position[0], spec.position[1] + 22, spec.position[2]);
      group.add(label);
    }

    // floating dust particles
    const dustCount = 220;
    const dustPos = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      dustPos[i * 3] = (Math.random() - 0.5) * 480;
      dustPos[i * 3 + 1] = (Math.random() - 0.5) * 210;
      dustPos[i * 3 + 2] = (Math.random() - 0.5) * 280;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    const dust = new THREE.Points(
      dustGeo,
      new THREE.PointsMaterial({
        color: 0x67e8f9,
        size: 1.6,
        transparent: true,
        opacity: 0.45,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    group.add(dust);

    let raf = 0;
    const clock = new THREE.Clock();
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      group.rotation.y = Math.sin(t * 0.12) * 0.3;
      group.rotation.x = Math.sin(t * 0.09) * 0.05;

      const { active: act, failed: isFailed } = stateRef.current;
      nodeMeshes.forEach((mesh, id) => {
        const isActive = id === act;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        mat.emissive.copy(isActive && isFailed ? new THREE.Color(0xf43f5e) : baseColors.get(id)!);
        mat.emissiveIntensity = isActive ? 0.95 + Math.sin(t * 5) * 0.45 : 0.3;
        mesh.scale.setScalar(isActive ? 1.14 + Math.sin(t * 5) * 0.07 : 1);
        mesh.rotation.y = t * (isActive ? 0.9 : 0.25);
        mesh.rotation.x = t * 0.15;
      });

      renderer.render(scene, camera);
    };
    animate();

    const resize = () => {
      const w = container.clientWidth;
      const h = Math.max(container.clientHeight, 1);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return <div ref={containerRef} className="h-full w-full" dir="ltr" />;
}
