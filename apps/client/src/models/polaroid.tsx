import { useGLTF } from '@react-three/drei'
import { Euler, ThreeElements, Vector3 } from '@react-three/fiber'
import { forwardRef, JSX, RefObject } from 'react'
import { GLTF } from 'three-stdlib'
import { CanvasTexture, Group, Mesh, MeshStandardMaterial } from 'three'
import { animated } from '@react-spring/three'

// A soft radial falloff used as an alpha map for the drop-shadow plane
// below — built once at module load (not per-card-instance: up to ~20
// Polaroids share this one texture) rather than shipping another binary
// asset for what's just a blurred circle.
const shadowTexture = (() => {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2
  )
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.75, 'rgba(255,255,255,0.9)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  return new CanvasTexture(canvas)
})()

type GLTFResult = GLTF & {
  nodes: {
    Object_3: Mesh
    Object_3001: Mesh
    Object_4: Mesh
    Object_5: Mesh
  }
  materials: {
    Frameblinn2SG: MeshStandardMaterial
    ['Material.001']: MeshStandardMaterial
    Framelambert79SG: MeshStandardMaterial
    initialShadingGroup: MeshStandardMaterial
  }
}

// Every Object_3/Object_4/Object_5 mesh below shares this same identity
// transform — hoisted so the ~20 on-screen Polaroid instances in the
// choose-screen carousel aren't each allocating three fresh arrays per
// render.
const rotation = [0, 0, 0]
const position = [0, 0, 0]
const scale = [1.0, 1.0, 1.0]

const Polaroid = forwardRef<
  Group,
  ThreeElements['group'] & {
    passthroughMaterial: JSX.Element
    intersectRef?: RefObject<Mesh>
  }
>((props, ref) => {
  const { nodes, materials } = useGLTF(
    '/models/polaroid.glb'
  ) as unknown as GLTFResult

  materials['Material.001'].transparent = true

  return (
    <animated.group ref={ref} {...props} dispose={null}>
      {/* Drop shadow — the carousel fans these out close enough that a
          card in front routinely overlaps its neighbor's screen
          position, and with nothing but the frame's own flat color the
          overlap read as two cards fighting for the same pixels rather
          than one sitting in front of the other. A soft radial falloff
          behind the frame (bigger than it, so the edge peeks out) gives
          that overlap a believable "resting on top of" cue instead.
          `depthWrite={false}` keeps it from blocking anything actually
          behind it in the depth buffer — it's meant to be seen through,
          not occlude. */}
      <mesh position={[0, 0.23, -0.3]}>
        <planeGeometry args={[3.5, 3.6]} />
        <meshBasicMaterial
          color="black"
          alphaMap={shadowTexture}
          transparent
          opacity={0.6}
          depthWrite={false}
        />
      </mesh>

      {/* Overlay */}
      <mesh
        castShadow
        receiveShadow
        geometry={nodes.Object_3001.geometry}
        material={materials['Material.001']}
        position={[0, 0, 0.001]}
      />

      {/* Inside */}
      <mesh
        ref={props.intersectRef}
        castShadow
        receiveShadow
        geometry={nodes.Object_3.geometry}
        rotation={rotation as Euler}
        position={position as Vector3}
        scale={scale as Vector3}
      >
        {props.passthroughMaterial}
      </mesh>
      {/* Back */}
      <mesh
        castShadow
        receiveShadow
        geometry={nodes.Object_4.geometry}
        material={materials.Framelambert79SG}
        rotation={rotation as Euler}
        position={position as Vector3}
        scale={scale as Vector3}
      />
      {/* Front */}
      <mesh
        castShadow
        receiveShadow
        geometry={nodes.Object_5.geometry}
        material={materials.initialShadingGroup}
        rotation={rotation as Euler}
        position={position as Vector3}
        scale={scale as Vector3}
      />
    </animated.group>
  )
})

Polaroid.displayName = 'Polaroid'

export default Polaroid

useGLTF.preload('/models/polaroid.glb')
