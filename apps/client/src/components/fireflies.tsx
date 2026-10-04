import { useEffect, useMemo, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  MathUtils,
  NormalBlending,
  ShaderMaterial,
} from 'three'
import { useStore } from '../store'

// Bugs drifting over the lake: soft points that wander on slow, overlapping
// sine paths, with a fast low-amplitude jitter on top (the darting) and a
// per-bug flicker. Warm glowing fireflies in dark mode (additive); on a light
// page an additive glow would vanish, so there they're small dark gnats.
//
// Two layers, so they sit *in* the scene rather than on top of it:
// - `back`: depth-tested, so anything genuinely in front (the player's
//   polaroid) hides them, and drawn before the carousel, whose cards draw as
//   layers over everything (see slider.tsx) and so cover them.
// - `front`: a few, closer to the camera, drawn after everything with no
//   depth test.
// three.js sorts transparent objects by their nearest group's renderOrder
// before their own, so each layer's order goes on a wrapping group.
//
// Fixed in view (rendered outside the scroll container), so the swarm stays
// with the viewer while the page scrolls underneath it. While a video plays
// the bugs fly off out of frame, and drift back when it stops. Skipped entirely for
// people who've asked for reduced motion.

// How quickly the swarm clears out when a video starts (and drifts back
// when it stops), as a MathUtils.damp rate — roughly a few seconds.
const SCATTER_RATE = 0.8

const BACK_COUNT = 70
const FRONT_COUNT = 12
// renderOrder for each layer: before anything else in the scene, and after
// the carousel's card layers (1000+, see slider.tsx).
const BACK_RENDER_ORDER = -1
const FRONT_RENDER_ORDER = 3000

const vertexShader = /* glsl */ `
  attribute vec4 aSeed;
  uniform float uTime;
  uniform float uSize;
  uniform float uPixelRatio;
  uniform float uScatter;
  uniform float uExtent;
  varying float vFlicker;

  void main() {
    // Each bug gets its own frequencies and phases from its seed, so no two
    // move in step.
    vec4 s = aSeed;
    float t = uTime;
    vec3 wander = vec3(
      sin(t * (0.13 + s.x * 0.17) + s.y * 6.28) * 0.18,
      sin(t * (0.11 + s.z * 0.15) + s.w * 6.28) * 0.12,
      sin(t * (0.09 + s.y * 0.12) + s.x * 6.28) * 0.10
    );
    vec3 dart = vec3(
      sin(t * (5.0 + s.w * 4.0) + s.z * 6.28),
      sin(t * (6.0 + s.x * 5.0) + s.y * 6.28),
      0.0
    ) * 0.006;

    // While a video plays, each bug flies off radially from the centre of
    // the frame, staggered so they don't leave as one ring, accelerating
    // as they go (squared), far enough to clear the frame from anywhere.
    vec2 away = normalize(position.xy + vec2(0.0001, 0.0001));
    float leave = smoothstep(0.0, 1.0, clamp(uScatter * 1.6 - s.z * 0.6, 0.0, 1.0));
    vec3 scatter = vec3(away * leave * leave * uExtent * (1.0 + s.y), 0.0);

    vec4 mvPosition = modelViewMatrix * vec4(position + wander + dart + scatter, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = uSize * uPixelRatio * (1.0 / -mvPosition.z) * (0.6 + s.x * 0.8);

    // Mostly lit, with the occasional slow dim-out.
    float pulse = sin(t * (0.7 + s.z * 1.3) + s.w * 6.28);
    vFlicker = smoothstep(-0.6, 0.4, pulse);
  }
`

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vFlicker;

  void main() {
    // A soft round dot with a bright core.
    float d = length(gl_PointCoord - 0.5);
    float glow = pow(smoothstep(0.5, 0.0, d), 2.0);
    gl_FragColor = vec4(uColor, glow * vFlicker * uOpacity);
  }
`

const LOOKS = {
  dark: { color: '#ffd98a', opacity: 0.9, size: 26, blending: AdditiveBlending },
  light: { color: '#4a4334', opacity: 0.55, size: 12, blending: NormalBlending },
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return reduced
}

function Swarm({
  count,
  depth,
  renderOrder,
  depthTest,
}: {
  count: number
  /** [near, far] z range, in world units. */
  depth: [number, number]
  renderOrder: number
  depthTest: boolean
}) {
  const { width, height } = useThree((state) => state.viewport)
  const dpr = useThree((state) => state.viewport.dpr)
  const colorScheme = useStore((state) => state.colorScheme)

  const geometry = useMemo(() => {
    const positions = new Float32Array(count * 3)
    const seeds = new Float32Array(count * 4)
    for (let i = 0; i < count; i++) {
      // Spread a little past the viewport's edges so bugs drift in and out.
      positions[i * 3] = (Math.random() - 0.5) * width * 1.2
      positions[i * 3 + 1] = (Math.random() - 0.5) * height * 1.1
      positions[i * 3 + 2] = depth[0] + Math.random() * (depth[1] - depth[0])
      for (let j = 0; j < 4; j++) seeds[i * 4 + j] = Math.random()
    }

    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(positions, 3))
    geometry.setAttribute('aSeed', new BufferAttribute(seeds, 4))
    return geometry
  }, [count, width, height, depth[0], depth[1]])

  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader,
        fragmentShader,
        transparent: true,
        depthTest,
        depthWrite: false,
        uniforms: {
          uTime: { value: 0 },
          uSize: { value: 1 },
          uPixelRatio: { value: 1 },
          uColor: { value: new Color() },
          uOpacity: { value: 1 },
          uScatter: { value: 0 },
          uExtent: { value: 1 },
        },
      }),
    [depthTest]
  )

  useEffect(() => {
    const look = LOOKS[colorScheme]
    material.uniforms.uColor.value.set(look.color)
    material.uniforms.uOpacity.value = look.opacity
    material.uniforms.uSize.value = look.size
    material.blending = look.blending
    material.needsUpdate = true
  }, [colorScheme, material])

  useEffect(() => {
    material.uniforms.uPixelRatio.value = dpr
  }, [dpr, material])

  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material]
  )

  useEffect(() => {
    material.uniforms.uExtent.value = Math.max(width, height)
  }, [width, height, material])

  useFrame((state, delta) => {
    material.uniforms.uTime.value = state.clock.elapsedTime
    // Eased toward 1 while a dream's video is playing, back to 0 (the bugs
    // drift home) when it pauses or the player closes.
    const { dream, videoPlaying } = useStore.getState()
    const target = dream && videoPlaying ? 1 : 0
    const scatter = material.uniforms.uScatter
    scatter.value = MathUtils.damp(scatter.value, target, SCATTER_RATE, delta)
  })

  return (
    <group
      ref={(el) => {
        if (el) el.renderOrder = renderOrder
      }}
    >
      <points
        ref={(el) => {
          if (!el) return
          el.renderOrder = renderOrder
          // Positions move in the shader, so the CPU-side bounds are wrong.
          el.frustumCulled = false
        }}
        geometry={geometry}
        material={material}
      />
    </group>
  )
}

function Fireflies() {
  const reducedMotion = useReducedMotion()
  if (reducedMotion) return null

  return (
    <>
      <Swarm
        count={BACK_COUNT}
        depth={[-0.9, 0.3]}
        renderOrder={BACK_RENDER_ORDER}
        depthTest
      />
      <Swarm
        count={FRONT_COUNT}
        depth={[0.6, 1.1]}
        renderOrder={FRONT_RENDER_ORDER}
        depthTest={false}
      />
    </>
  )
}

export default Fireflies
