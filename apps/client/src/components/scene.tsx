import {
	DeviceOrientationControls,
	OrbitControls,
	PerspectiveCamera,
	Scroll,
	ScrollControls,
} from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { RefObject, useEffect, useMemo, useRef, useState } from "react";
import {
	MathUtils,
	Mesh,
	MeshStandardMaterial,
	PerspectiveCamera as PerspectiveCameraType,
	SpotLight,
	Event as ThreeEvent,
} from "three";
import { useStore } from "../store";
import { getRotation } from "../utils";
import Choose from "../views/choose";
import Main from "../views/main";

function Scene({ video }: { video: RefObject<HTMLVideoElement | null> }) {
	const camera = useRef<PerspectiveCameraType>(null);
	const { viewport } = useThree((state) => state);
	const { width: w, height: h } = viewport;
	const CAMERA_Z = 1.5;
	const isMobile = useStore((state) => state.isMobile);
	const isTouch = useStore((state) => state.isTouch);

	const dream = useStore((state) => state.dream);
	const setShowPlayhead = useStore((state) => state.setShowPlayhead);
	const initialRotation = useStore((state) => state.initialRotation);
	const polaroidVisible = useStore((state) => state.polaroidVisible);
	const resetting = useStore((state) => state.resetting);
	const isTooSlow = useStore((state) => state.isTooSlow);
	const setIsTooSlow = useStore((state) => state.setIsTooSlow);
	const videoState = useStore((state) => state.videoState);

	// These three all used to be React state set every frame from useFrame,
	// re-rendering Scene (and everything under it, including Choose's whole
	// Slider) 60x/sec — see choose.tsx and main.tsx for the fuller writeup of
	// this pattern. `globalPointer` in particular used to mirror the store's
	// per-frame pointer value into local state purely so the dot mesh below
	// could read it reactively; it's set directly on the mesh ref instead now.
	const bufferingDelayRef = useRef(0);
	const dotMesh = useRef<Mesh>(null);
	const dotMaterial = useRef<MeshStandardMaterial>(null);

	const setInitialRotation = useStore((state) => state.setInitialRotation);
	const resetInitialRotation = useStore((state) => state.resetInitialRotation);
	const setResetInitialRotation = useStore(
		(state) => state.setResetInitialRotation,
	);
	useEffect(() => {
		setShowPlayhead(dream !== null && !resetting);
	}, [dream, resetting]);

	useFrame((state, delta) => {
		const cameraRef = camera.current;

		if (videoState < HTMLMediaElement.HAVE_FUTURE_DATA) {
			bufferingDelayRef.current += delta;

			if (bufferingDelayRef.current >= 8 && !isTooSlow) {
				console.log("Okay, maybe YouTube");
				setIsTooSlow(true);
			}
		}

		if (isMobile || isTouch) {
			if (dotMaterial.current) dotMaterial.current.opacity = polaroidVisible;
		}

		const pointer = useStore.getState().globalPointer;
		if (dotMesh.current) {
			dotMesh.current.position.set(pointer.x - 1.0, pointer.y - 1.0, -0.5);
		}

		if (cameraRef && !isMobile && !isTouch) {
			cameraRef.position.x = MathUtils.lerp(
				cameraRef.position.x,
				-state.pointer.x / 8,
				0.05,
			);
			cameraRef.position.y = MathUtils.lerp(
				cameraRef.position.y,
				-state.pointer.y / 8,
				0.05,
			);

			cameraRef.position.z = MathUtils.lerp(
				cameraRef.position.z,
				CAMERA_Z - state.pointer.y / 4,
				0.01,
			);
		}
	});

	const fakeCamera = new PerspectiveCameraType();

	const [rotation, setRotation] = useState([0, 0, 0]);

	const onOrientationChange = (e?: ThreeEvent) => {
		if (resetInitialRotation) {
			const r = getRotation(e, [0, 0, 0]);
			setInitialRotation(r as [number, number, number]);
			setResetInitialRotation(false);
			setRotation(r as number[]);
		} else {
			const r = getRotation(e, initialRotation);
			setRotation(r as number[]);
		}
	};

	const spotlight = useMemo(() => new SpotLight("#fff"), []);

	return (
		<>
			<PerspectiveCamera
				ref={camera}
				makeDefault
				position={[0, 0, CAMERA_Z]}
				fov={50}
				zoom={w >= 1 ? 1 : w}
			/>
			{isMobile ? (
				<DeviceOrientationControls
					camera={fakeCamera}
					onChange={onOrientationChange}
				/>
			) : null}
			{!isMobile && !isTouch ? (
				<OrbitControls enableRotate={false} enableZoom={false} />
			) : null}
			<ambientLight intensity={0.5} />
			<group>
				{/* decay={0} — three.js dropped the legacy (non-physically-correct)
            lighting mode this session's three/fiber bump pulled in, so this
            light's intensity is now read as physical candela with real
            inverse-square falloff by default. At 30 units away that made it
            contribute almost nothing, leaving the polaroid frames lit by
            flat ambient only (gray/washed out) instead of this light's
            highlights. decay={0} restores the old flat, distance-independent
            falloff this scene was tuned for; intensity bumped to 2 on top of
            that to bring the frames back up to a proper bright white. */}
				<primitive
					object={spotlight}
					position={[5, 0, 30]}
					intensity={5}
					decay={0}
					castShadow
					shadow-bias={-0.01}
					shadow-mapSize-width={1024}
					shadow-mapSize-height={1024}
				/>
				<primitive object={spotlight.target} position={[0, 0, 0]} />
			</group>

			<ScrollControls pages={2.7} damping={0.1}>
				<Scroll>
					<Choose position={[0, 0, 0]} />
					<Main video={video} position={[0, -h * 1.6, 0]} tilt={rotation} />
				</Scroll>
			</ScrollControls>

			{isMobile || isTouch ? (
				<>
					<mesh
						ref={dotMesh}
						visible={dream !== null && !resetting}
						scale={0.025}
					>
						<circleGeometry args={[1, 16]} />
						<meshStandardMaterial ref={dotMaterial} color="#666" transparent />
					</mesh>
				</>
			) : null}
		</>
	);
}

export default Scene;
