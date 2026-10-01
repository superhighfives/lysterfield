import {
  MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Euler, MathUtils, Object3D, Vector3 } from 'three'
import { useCursor, Center } from '@react-three/drei'
import { animated, useSprings } from '@react-spring/three'
import { useGesture } from '@use-gesture/react'
import { useStore } from '../store'
import { Dream } from '../utils/types'

// Per-frame lerp factors for the pointer tilt: the centre card eases at
// TILT_EASE_NEAR, falling to TILT_EASE_FAR by TILT_STAGGER_CARDS card
// widths out.
const TILT_EASE_NEAR = 0.12
const TILT_EASE_FAR = 0.02
const TILT_STAGGER_CARDS = 5
// Card float, in slider units (one card is `width` = 0.3 wide): how far a
// card drifts toward the pointer at the screen edge (scaled per card by
// 0.6-1.4x), and the amplitude of its idle bob.
const FLOAT_DRIFT_X = 0.035
const FLOAT_DRIFT_Y = 0.03
const FLOAT_BOB = 0.008

export default function Slider({
  items,
  isDragging,
  width = 600,
  visible = 4,
  children,
}: {
  items: Dream[]
  isDragging: MutableRefObject<boolean>
  width?: number
  visible?: number
  style?: { string: string }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  children: any
}) {
  const isTouch = useStore((state) => state.isTouch)

  const idx = useCallback(
    (x: number, l = items.length) => (x < 0 ? x + l : x) % l,
    [items]
  )
  const getPos = useCallback(
    (i: number, firstVis: number, firstVisIdx: number) =>
      idx(i - firstVis + firstVisIdx),
    [idx]
  )
  const [springs, api] = useSprings(items.length, (i) => ({
    position: [(i < items.length - 1 ? i : -1) * width, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  }))
  const prev = useRef([0, 1])
  // Each card's Polaroid photo/overlay meshes and its title/prompt Text
  // are all separate transparent objects with their own bounding
  // spheres, offset and rotated per-card — three.js's automatic
  // back-to-front sort for transparent objects (by bounding-sphere
  // distance to camera) can get that wrong at the carousel's steeper
  // rotation angles, letting a neighboring card's text or overlay
  // render on top of a card that should occlude it. `z` below is
  // monotonic in `rank` (both derive from the same `xpos`), so setting
  // an explicit per-card `renderOrder` from `rank` forces three.js to
  // respect the carousel's own front-to-back order instead of guessing.
  const cardRefs = useRef<Record<number, Object3D | null>>({})

  const runSprings = useCallback(
    (y: number, dy: number) => {
      const firstVis = idx(Math.floor(y / width) % items.length)
      const firstVisIdx = dy < 0 ? items.length - visible + 1 : 1
      api.start((i) => {
        const position = getPos(i, firstVis, firstVisIdx)
        const prevPosition = getPos(i, prev.current[0], prev.current[1])
        const rank =
          firstVis - (y < 0 ? items.length : 0) + position - firstVisIdx - 1
        const configPos = dy > 0 ? position : items.length - position
        const scale = 1.0
        const card = cardRefs.current[i]
        if (card) {
          const renderOrder = Math.round(rank)
          card.traverse((child) => {
            child.renderOrder = renderOrder
          })
        }

        return {
          position: [
            (-y % (width * items.length)) + width * rank,
            0.4 + ((-y % (width * items.length)) + width * rank) / -10,
            -(((-y % (width * items.length)) + width * rank - 1) / 2) * -1,
          ],
          rotation: [
            0.1,
            (((-y % (width * items.length)) + width * rank - 2.75) / 1.5) * -1,
            ((-y % (width * items.length)) + width * rank) / 5 - 0.5,
          ],
          scale: [scale, scale, scale],
          immediate: dy < 0 ? prevPosition > position : prevPosition < position,
          config: {
            tension: (1 + items.length - configPos) * 500,
            friction: 30 + configPos * 40,
            precision: 0.000001,
          },
        }
      })
      prev.current = [firstVis, firstVisIdx]
    },
    [idx, getPos, width, visible, api, items.length]
  )

  const [initalisedVisuals, setInitalisedVisuals] = useState(false)
  useEffect(() => {
    if (initalisedVisuals) return
    // Calling this during render (rather than here) used to work, but is a
    // real violation of React's rules — React 19 renders components twice
    // in a row to catch exactly this, and it was scheduling duplicate
    // overlapping timeouts as a result.
    const timeout = setTimeout(() => {
      runSprings(Math.random() * 1000, 0)
      setInitalisedVisuals(true)
    })
    return () => clearTimeout(timeout)
  }, [initalisedVisuals, runSprings])

  const wheelOffset = useRef(0)
  const dragOffset = useRef(0)

  const [hover, setHover] = useState(false)
  // Was React state (`const [px, setX] = useState(0)`) driven from
  // useFrame every frame — px is never read in JSX, only fed into
  // runSprings (an imperative react-spring call) and plain refs, so there
  // was never a reason for it to trigger a re-render. At 60fps that meant
  // Slider (and every visible card's useTexture call inside it) re-rendered
  // 60x/sec, which combined with drei's useTexture render-phase side effect
  // to trip React 19's "Maximum update depth exceeded" safety limit.
  const px = useRef(0)
  const [triggerInteractive, setTriggerInteractive] = useState(false)

  useCursor(hover)

  useFrame((_state, delta) => {
    if ((!triggerInteractive || isTouch) && !isDragging.current) {
      const positionX = px.current + delta / 10
      px.current = positionX
      wheelOffset.current = dragOffset.current = positionX
      runSprings(positionX, 1)
    }
  })

  const bind = useGesture(
    {
      onDrag: ({ offset: [x], direction: [dx], first, last }) => {
        if (dx) {
          if (!triggerInteractive) setTriggerInteractive(true)
          x = x / 750
          dragOffset.current = -x + px.current
          runSprings(wheelOffset.current + -x, -dx)
        }

        if (first) {
          isDragging.current = true
        } else if (last) {
          requestAnimationFrame(() => (isDragging.current = false))
        }
      },
      onWheel: ({ offset: [x], direction: [dx], first, last }) => {
        if (dx) {
          if (!triggerInteractive) setTriggerInteractive(true)
          x = x / 1000
          wheelOffset.current = x + px.current
          runSprings(dragOffset.current + x, dx)
        }

        if (first) {
          isDragging.current = true
        } else if (last) {
          requestAnimationFrame(() => (isDragging.current = false))
        }
      },
      onHover: ({ hovering }) => {
        setHover(hovering || false)
      },
    },
    {
      wheel: { eventOptions: { passive: false } },
      drag: { filterTaps: true },
    }
  )

  const { width: w } = useThree((state) => state.viewport)

  // Each card also floats on its own, inside the spring-driven group, so
  // the row reads as separate cards drifting rather than one rigid object
  // pivoting with the camera's parallax:
  // - it tilts and drifts (x/y) toward the pointer, by its own amount,
  //   easing at a rate that falls off with distance from the centre — the
  //   front cards answer first and the rest follow in a ripple;
  // - and it bobs gently on its own, at its own speed and phase, so the
  //   cards keep moving independently even with the pointer still.
  const tiltRefs = useRef<Record<number, Object3D | null>>({})
  useFrame((state) => {
    const { x: pointerX, y: pointerY } = state.pointer
    const time = state.clock.elapsedTime
    springs.forEach(({ position }, i) => {
      const tilt = tiltRefs.current[i]
      if (!tilt) return
      const distance = Math.abs(position.get()[0]) / (width * TILT_STAGGER_CARDS)
      const ease = MathUtils.lerp(
        TILT_EASE_NEAR,
        TILT_EASE_FAR,
        MathUtils.clamp(distance, 0, 1)
      )
      // Stable per-card pseudo-random values in [0, 1) (golden-ratio
      // sequence), so no two neighbours drift or bob in step.
      const seedA = (i * 0.618034) % 1
      const seedB = (i * 0.414214 + 0.5) % 1
      const reach = 0.6 + seedA * 0.8
      const bobSpeed = 0.5 + seedB * 0.5
      const bobPhase = seedA * Math.PI * 2

      const driftX = pointerX * FLOAT_DRIFT_X * reach
      const driftY =
        pointerY * FLOAT_DRIFT_Y * reach +
        Math.sin(time * bobSpeed + bobPhase) * FLOAT_BOB
      const driftZ = Math.cos(time * bobSpeed * 0.7 + bobPhase) * FLOAT_BOB

      tilt.rotation.x = MathUtils.lerp(tilt.rotation.x, -pointerY * 0.12 * reach, ease)
      tilt.rotation.y = MathUtils.lerp(tilt.rotation.y, pointerX * 0.18 * reach, ease)
      tilt.position.x = MathUtils.lerp(tilt.position.x, driftX, ease)
      tilt.position.y = MathUtils.lerp(tilt.position.y, driftY, ease)
      tilt.position.z = MathUtils.lerp(tilt.position.z, driftZ, ease)
    })
  })

  return (
    <>
      {!isTouch ? (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        <mesh position={[0, 0, 0]} {...(bind() as any)}>
          <planeGeometry args={[MathUtils.clamp(w, 1.0, 10.0), 0.5, 1]} />
          <meshBasicMaterial visible={false} />
        </mesh>
      ) : null}

      <Center position={[0, 0, -0.4]}>
        {springs.map(({ position, rotation, scale }, i) => (
          <animated.group
            ref={(el) => {
              cardRefs.current[i] = el
            }}
            position={position as unknown as Vector3}
            scale={scale as unknown as Vector3}
            rotation={rotation as unknown as Euler}
            key={i}
          >
            <group
              ref={(el) => {
                tiltRefs.current[i] = el
              }}
            >
              {children(items[i], i)}
            </group>
          </animated.group>
        ))}
      </Center>
    </>
  )
}
