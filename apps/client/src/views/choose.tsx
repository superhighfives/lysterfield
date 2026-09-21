/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ThreeElements, useFrame, useThree } from '@react-three/fiber'
import { Euler, MathUtils, Mesh, MeshBasicMaterial, Vector3 } from 'three'
import type { Dream } from '../utils/types'
import Polaroid from '../models/polaroid'
import { PolaroidMaterial } from '../materials/polaroid-material'
import {
  useCursor,
  useIntersect,
  useScroll,
  useTexture,
  useVideoTexture,
  Text,
} from '@react-three/drei'
import { animated, useSpring, config, a } from '@react-spring/three'
import { useStore } from '../store'
import Slider from '../components/slider'

function Choose(props: ThreeElements['group']) {
  const collection = useStore((state) => state.collection)
  const isMobile = useStore((state) => state.isMobile)
  const dream = useStore((state) => state.dream)
  const setDream = useStore((state) => state.setDream)
  const setPolaroidVisible = useStore((state) => state.setPolaroidVisible)

  const titleVisible = useRef(false)
  const titleRef = useIntersect<Mesh>(
    (isVisible) => (titleVisible.current = isVisible)
  )

  const titleMask = useVideoTexture(`/video/title.mov`, {
    loop: false,
    start: false,
  })

  const titleImage = useVideoTexture(`/assets/${collection[0].id}/loop.mov`)

  // `[...collection, ...collection]` created a brand-new array every render
  // — Slider's internal useCallback chain (idx -> getPos -> runSprings) all
  // depend on `items`, so a fresh reference every render meant `runSprings`
  // never stabilized, its consuming effect kept re-firing, and combined
  // with drei's useTexture render-phase side effect (see the per-item
  // texture load below) that cascaded into a real "Maximum update depth
  // exceeded" loop under React 19. Memoized so the reference only changes
  // when `collection` itself actually does.
  const doubledCollection = useMemo(
    () => [...collection, ...collection],
    [collection]
  )

  useEffect(() => {
    if (titleVisible) {
      titleMask.source.data.play()
    }
  }, [titleVisible])

  const { height: h } = useThree((state) => state.viewport)

  const data = useScroll()
  // These all used to be React state, recomputed every frame via useFrame —
  // Choose renders the whole Slider (up to ~20 polaroid cards, each with
  // its own useTexture call) underneath it, so a state update here 60x/sec
  // was re-rendering all of that every frame. None of these values are
  // read reactively in a way that needs a React re-render: the two opacity
  // values are set directly on their material refs below, and the two
  // spring-driven values move to react-spring's imperative .start() api —
  // see plans/in-progress panel-3 doc's sibling investigation, and
  // main.tsx's equivalent fix, for the fuller writeup of this pattern.
  const welcomeVisibilityRef = useRef(0)
  const whichVisibilityRef = useRef(1)
  const polaroidVisibilityRef = useRef(0)
  const welcomeMaterial = useRef<MeshBasicMaterial>(null)
  const whichMaterial = useRef<MeshBasicMaterial>(null)

  const POLAROID_WIDTH = 0.3

  const [{ opacity: actionScrollOpacity }, actionScrollApi] = useSpring(
    () => ({
      opacity: 1,
      config: { ...config.default, precision: 0.0000001 },
    })
  )

  const [{ position: polaroidPosition }, polaroidApi] = useSpring(() => ({
    position: [0, -h * 1.8, 0],
    config: { ...config.molasses, precision: 0.0000001 },
  }))

  useFrame(() => {
    const nextPolaroidVisibility = !dream
      ? MathUtils.lerp(
          polaroidVisibilityRef.current,
          data.range(-0.01, 5 / 10),
          0.1
        )
      : MathUtils.lerp(polaroidVisibilityRef.current, 0, 0.1)
    polaroidVisibilityRef.current = nextPolaroidVisibility
    polaroidApi.start({
      position: [0, -h * (1.8 + (1 - nextPolaroidVisibility) * 2), 0],
    })

    const nextWelcomeVisibility = MathUtils.lerp(
      welcomeVisibilityRef.current,
      data.curve(1 / 10, 9 / 10),
      0.1
    )
    welcomeVisibilityRef.current = nextWelcomeVisibility
    if (welcomeMaterial.current) {
      welcomeMaterial.current.opacity = nextWelcomeVisibility
    }

    actionScrollApi.start({ opacity: 1.0 - data.range(0, 1 / 100) })

    const nextWhichVisibility = MathUtils.lerp(
      whichVisibilityRef.current,
      dream ? 0 : data.range(2 / 3, 1 / 3),
      0.1
    )
    whichVisibilityRef.current = nextWhichVisibility
    if (whichMaterial.current) {
      whichMaterial.current.opacity = nextWhichVisibility
    }

    setPolaroidVisible(data.range(4 / 5, 0.3))
  })

  const welcome = useTexture('images/welcome.png')
  const actionScroll = useTexture('images/action-scroll.png')
  const which = useTexture('images/choose.png')

  const isDragging = useRef(false)
  const isDoubleClicked = useRef(false)
  const previousClickTimestamp = useRef(performance.now())
  const DOUBLE_CLICK_TIME_THRESHOLD = 250

  function handleClick(e: Event, dream: Dream) {
    e.stopPropagation()

    if (!isMobile) {
      if (isDragging.current) return
      const now = performance.now()
      const clickDeltaTime = now - previousClickTimestamp.current
      if (
        isDoubleClicked.current ||
        clickDeltaTime >= DOUBLE_CLICK_TIME_THRESHOLD
      ) {
        setDream(dream)
        isDoubleClicked.current = false
      } else {
        isDoubleClicked.current = true
      }

      previousClickTimestamp.current = now
    } else {
      setDream(dream)
    }
  }

  const PolaroidShaderWrapper = a(({ ...props }) => (
    <polaroidMaterial {...props} />
  ))

  return (
    <group {...props}>
      {/* Title */}
      <mesh ref={titleRef} position={[0, 0, -0.75]} scale={1.5}>
        <planeGeometry />
        <meshBasicMaterial transparent alphaMap={titleMask} map={titleImage} />
      </mesh>

      {/* Action Scroll */}
      <mesh position={[0, -0.7, -0.25]} scale={0.1}>
        <planeGeometry
          args={[1, actionScroll.image.height / actionScroll.image.width, 1]}
        />
        {/* eslint-disable-next-line @typescript-eslint/ban-ts-comment */}
        {/* @ts-ignore: https://github.com/pmndrs/react-spring/issues/1515 */}
        <animated.meshBasicMaterial
          opacity={actionScrollOpacity}
          transparent
          map={actionScroll}
        />
      </mesh>

      {/* Welcome */}
      <mesh position={[0, -1.2, 0]}>
        <planeGeometry
          args={[1, welcome.image.height / welcome.image.width, 1]}
        />
        <meshBasicMaterial ref={welcomeMaterial} transparent map={welcome} />
      </mesh>

      {/* Choose */}
      <mesh position={[0, -h * 1.4, 0]}>
        <planeGeometry args={[1, which.image.height / which.image.width, 1]} />
        <meshBasicMaterial ref={whichMaterial} transparent map={which} />
      </mesh>
      <animated.group position={polaroidPosition as unknown as Vector3}>
        <Slider
          items={doubledCollection}
          isDragging={isDragging}
          width={POLAROID_WIDTH}
          visible={collection.length * 2 - 1}
        >
          {(dream: Dream) => {
            const textureImage = useTexture(`/assets/${dream.id}/hero.jpg`)
            const [hover, setHover] = useState(false)
            useCursor(hover)

            // Was React state polled every frame via useFrame — size only
            // actually changes on window resize, and this whole block runs
            // once per visible card (up to ~20), so that was up to 20
            // useFrame subscriptions each calling two setStates 60x/sec.
            // useThree's selector already only re-renders on a real resize.
            const { width: canvasWidth, height: canvasHeight } = useThree(
              (state) => state.size
            )
            const size = [canvasWidth, canvasHeight]
            const aspect =
              canvasWidth > canvasHeight
                ? [1, canvasWidth / canvasHeight]
                : [canvasHeight / canvasWidth, 1]

            const { uHover: hoverAmount } = useSpring({
              uHover: hover ? 1.0 : 0.0,
              config: { ...config.molasses, precision: 0.0000001 },
            })

            const { scale: scaleAmount } = useSpring({
              scale: hover ? 0.12 : 0.1,
              config: { ...config.molasses, precision: 0.0000001 },
            })

            const { rotation: rotationAmount } = useSpring({
              rotation: hover ? [-0.25, 0, 0] : [0, 0, 0],
              config: { ...config.molasses, precision: 0.0000001 },
            })

            return (
              <animated.group
                key={dream.id}
                rotation={rotationAmount as unknown as Euler}
                scale={scaleAmount}
              >
                <Polaroid
                  onPointerOver={(e) => {
                    e.stopPropagation()
                    setHover(true)
                  }}
                  onPointerOut={(e) => {
                    e.stopPropagation()
                    setHover(false)
                  }}
                  onClick={(e) => handleClick(e as any, dream)}
                  passthroughMaterial={
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    //@ts-ignore: https://github.com/pmndrs/react-spring/issues/1515 */}
                    <PolaroidShaderWrapper
                      key={PolaroidMaterial.key}
                      uTexture={textureImage}
                      uSize={size}
                      uAspect={aspect}
                      uHover={hoverAmount}
                    />
                  }
                />
                <group position={[-1.55, -1.75, 0.1]}>
                  <Text
                    scale={0.25}
                    font="/fonts/redaction/Redaction_35-Italic.ttf"
                    color="black"
                    fillOpacity={0.8}
                    anchorX="left"
                    anchorY="middle"
                  >
                    {dream.title}
                  </Text>
                  <Text
                    scale={0.115}
                    position={[0, -0.25, 0]}
                    font="/fonts/space-mono/SpaceMono-Regular.ttf"
                    color="#bbb"
                    anchorX="left"
                    anchorY="middle"
                  >
                    {`"${dream.prompt}"`}
                  </Text>
                </group>
              </animated.group>
            )
          }}
        </Slider>
      </animated.group>
    </group>
  )
}

export default Choose
