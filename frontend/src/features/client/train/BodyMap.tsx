// 3D body map for the Train tab: realistic anatomy you can turn, zoom and click.
//
// Models: public/models/muscles.glb and bones.glb (CC BY-SA 4.0, adapted from
// Z-Anatomy and BodyParts3D; see public/models/README.md). Every muscle is its
// own node named `ta2-<id>.<side>`; anatomy.ts maps each to a name and to one of
// the app's 16 muscle groups. Coordinates are metres, +Y up, +Z anterior.

import { Component, Suspense, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Bvh, OrbitControls, useGLTF, useProgress } from '@react-three/drei'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { MuscleGroup } from '@/types/db'
import { BAND_HEX, setBand } from '@/lib/muscles'
import { muscleInfo } from './anatomy'

const MUSCLES_URL = '/models/muscles.glb'
const BONES_URL = '/models/bones.glb'
const CENTER_Y = 0.9 // model spans roughly y = 0 … 1.75

export type ColorMode = 'sets' | 'anatomy'

export interface HoverInfo { name: string; side: string | null; group: MuscleGroup | null; x: number; y: number }

const PALETTE = {
  light: { anatomy: '#b5483e', untracked: '#c0625a', untrackedSets: '#e3d6c9', bone: '#efe6d2', selected: '#ddac4f', hover: '#f0c46a' },
  dark: { anatomy: '#b04a40', untracked: '#97504a', untrackedSets: '#3f5a4c', bone: '#cfc4ae', selected: '#ddac4f', hover: '#f0c46a' },
}

interface MuscleMesh { mesh: THREE.Mesh; group: MuscleGroup | null }

function Anatomy({ sets, selected, colorMode, dark, onSelect, onHover, onReady }: {
  sets: Record<MuscleGroup, number>
  selected: MuscleGroup | null
  colorMode: ColorMode
  dark: boolean
  onSelect: (m: MuscleGroup, muscleName: string) => void
  onHover: (h: HoverInfo | null) => void
  onReady: (centers: Partial<Record<MuscleGroup, THREE.Vector3>>) => void
}) {
  const muscles = useGLTF(MUSCLES_URL, false, true)
  const bones = useGLTF(BONES_URL, false, true)
  const hovered = useRef<THREE.Mesh | null>(null)

  // One material per muscle group (plus untracked), so recolouring is cheap.
  const mats = useMemo(() => {
    const make = () => new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0, color: '#b5483e' })
    const byGroup = new Map<MuscleGroup | null, THREE.MeshStandardMaterial>()
    return { byGroup, make, hover: new THREE.MeshStandardMaterial({ roughness: 0.5, color: '#f0c46a', emissive: '#7a5410', emissiveIntensity: 0.35 }) }
  }, [])

  const { muscleScene, list } = useMemo(() => {
    const scene = muscles.scene.clone(true)
    const list: MuscleMesh[] = []
    scene.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh) return
      const mesh = o as THREE.Mesh
      const info = muscleInfo(mesh.userData.name ?? mesh.name) ?? muscleInfo(mesh.parent?.userData.name ?? mesh.parent?.name ?? '')
      const group = info?.group ?? null
      if (!mats.byGroup.has(group)) mats.byGroup.set(group, mats.make())
      mesh.material = mats.byGroup.get(group)!
      mesh.userData.muscle = info
      list.push({ mesh, group })
    })
    return { muscleScene: scene, list }
  }, [muscles.scene, mats])

  const boneScene = useMemo(() => {
    const scene = bones.scene.clone(true)
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.8, color: '#efe6d2' })
    scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        const mesh = o as THREE.Mesh
        mesh.material = mat
        mesh.raycast = () => {} // clicks go to muscles only
      }
    })
    return scene
  }, [bones.scene])

  // Group centres, used by the focus button.
  useEffect(() => {
    const boxes: Partial<Record<MuscleGroup, THREE.Box3>> = {}
    muscleScene.updateMatrixWorld(true)
    for (const { mesh, group } of list) {
      if (!group) continue
      const b = new THREE.Box3().setFromObject(mesh)
      boxes[group] = boxes[group] ? boxes[group]!.union(b) : b
    }
    const centers: Partial<Record<MuscleGroup, THREE.Vector3>> = {}
    for (const [g, b] of Object.entries(boxes)) centers[g as MuscleGroup] = b!.getCenter(new THREE.Vector3())
    onReady(centers)
  }, [muscleScene, list, onReady])

  // Colours: by sets this week, or plain anatomy.
  useEffect(() => {
    const p = dark ? PALETTE.dark : PALETTE.light
    const band = dark ? BAND_HEX.dark : BAND_HEX.light
    for (const [group, mat] of mats.byGroup) {
      let c: string
      if (group && group === selected) c = p.selected
      else if (colorMode === 'anatomy') c = group ? p.anatomy : p.untracked
      else c = group ? band[setBand(sets[group])] : p.untrackedSets
      mat.color.set(c)
    }
    boneScene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) ((o as THREE.Mesh).material as THREE.MeshStandardMaterial).color.set(p.bone)
    })
  }, [mats, sets, selected, colorMode, dark, boneScene])

  useEffect(() => () => { document.body.style.cursor = '' }, [])

  const setHovered = (mesh: THREE.Mesh | null) => {
    if (hovered.current === mesh) return
    if (hovered.current) {
      const prev = hovered.current
      prev.material = mats.byGroup.get(prev.userData.muscle?.group ?? null)!
    }
    hovered.current = mesh
    if (mesh) mesh.material = mats.hover
    document.body.style.cursor = mesh?.userData.muscle?.group ? 'pointer' : ''
  }

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    const mesh = e.object as THREE.Mesh
    const info = mesh.userData.muscle as ReturnType<typeof muscleInfo>
    setHovered(mesh)
    if (info) onHover({ name: info.name, side: info.side, group: info.group, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY })
  }

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    if (e.delta > 6) return // it was a drag to turn the body
    const info = (e.object as THREE.Mesh).userData.muscle as ReturnType<typeof muscleInfo>
    if (info?.group) onSelect(info.group, `${info.side ? `${info.side.toLowerCase()} ` : ''}${info.name.charAt(0).toLowerCase()}${info.name.slice(1)}`)
  }

  return (
    <group>
      <primitive object={boneScene} />
      <Bvh firstHitOnly>
        <primitive
          object={muscleScene}
          onPointerMove={onMove}
          onPointerOut={() => { setHovered(null); onHover(null) }}
          onClick={onClick}
        />
      </Bvh>
    </group>
  )
}

/** Turns the camera to the front or back and handles reset / focus requests. */
function CameraRig({ view, focus, resetKey, controls }: {
  view: 'front' | 'back'
  focus: THREE.Vector3 | null
  resetKey: number
  controls: React.RefObject<OrbitControlsImpl | null>
}) {
  const { camera } = useThree()
  const goal = useRef<{ az: number; dist: number; target: THREE.Vector3 } | null>(null)

  useEffect(() => {
    goal.current = { az: view === 'front' ? 0 : Math.PI, dist: 3.4, target: new THREE.Vector3(0, CENTER_Y, 0) }
  }, [view, resetKey])

  useEffect(() => {
    if (!focus) return
    // Face the side of the body the muscle is on.
    const az = focus.z < -0.02 ? Math.PI : focus.z > 0.02 ? 0 : view === 'front' ? 0 : Math.PI
    goal.current = { az, dist: 1.3, target: new THREE.Vector3(0, focus.y, 0) }
  }, [focus, view])

  useFrame(() => {
    const c = controls.current
    const g = goal.current
    if (!c || !g) return
    const k = 0.14
    c.target.lerp(g.target, k)
    const offset = camera.position.clone().sub(c.target)
    const sph = new THREE.Spherical().setFromVector3(offset)
    let dAz = g.az - sph.theta
    dAz = Math.atan2(Math.sin(dAz), Math.cos(dAz))
    sph.theta += dAz * k
    sph.phi += (Math.PI / 2 - 0.04 - sph.phi) * k
    sph.radius += (g.dist - sph.radius) * k
    camera.position.copy(c.target).add(new THREE.Vector3().setFromSpherical(sph))
    c.update()
    if (Math.abs(dAz) < 0.002 && Math.abs(g.dist - sph.radius) < 0.004 && c.target.distanceTo(g.target) < 0.002) goal.current = null
  })
  return null
}

// Progress is shown by <BodyMapProgress> outside the canvas.
const Loader = () => null

/** Shows load progress over the canvas while the models stream in. */
export function BodyMapProgress() {
  const { active, progress } = useProgress()
  if (!active) return null
  return <div className="map-loading">Loading 3D model… {Math.round(progress)}%</div>
}

class ModelErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed
      ? <div className="placeholder"><p>The 3D model couldn't load.</p><p className="small faint">Use the muscle list instead.</p></div>
      : this.props.children
  }
}

export interface BodyMapProps {
  sets: Record<MuscleGroup, number>
  selected: MuscleGroup | null
  onSelect: (m: MuscleGroup, muscleName: string) => void
  onHover: (h: HoverInfo | null) => void
  onReady: (centers: Partial<Record<MuscleGroup, THREE.Vector3>>) => void
  view: 'front' | 'back'
  resetKey: number
  focus: THREE.Vector3 | null
  zoom: boolean
  dark: boolean
  colorMode: ColorMode
}

export default function BodyMap({ sets, selected, onSelect, onHover, onReady, view, resetKey, focus, zoom, dark, colorMode }: BodyMapProps) {
  const controls = useRef<OrbitControlsImpl | null>(null)
  return (
    <ModelErrorBoundary>
      <Canvas camera={{ position: [0, CENTER_Y, 3.4], fov: 32, near: 0.05, far: 20 }} dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }} onPointerMissed={() => onHover(null)}
        aria-label="3D body map. Use the muscle list to choose with a keyboard.">
        <hemisphereLight args={[dark ? '#dfe9e2' : '#ffffff', dark ? '#1a2a22' : '#c9bfae', dark ? 1.1 : 1.3]} />
        <directionalLight position={[1.5, 2.5, 3]} intensity={dark ? 1.6 : 1.9} />
        <directionalLight position={[-2, 1.5, -3]} intensity={0.9} />
        <Suspense fallback={<Loader />}>
          <Anatomy sets={sets} selected={selected} colorMode={colorMode} dark={dark} onSelect={onSelect} onHover={onHover} onReady={onReady} />
        </Suspense>
        <OrbitControls ref={controls} target={[0, CENTER_Y, 0]} enablePan={false} enableZoom={zoom} minDistance={0.8} maxDistance={4.5}
          minPolarAngle={Math.PI / 2 - 0.6} maxPolarAngle={Math.PI / 2 + 0.4} rotateSpeed={0.8} />
        <CameraRig view={view} focus={focus} resetKey={resetKey} controls={controls} />
      </Canvas>
    </ModelErrorBoundary>
  )
}

useGLTF.preload(MUSCLES_URL, false, true)
useGLTF.preload(BONES_URL, false, true)
