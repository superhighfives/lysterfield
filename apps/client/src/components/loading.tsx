import { CircleNotch } from '@phosphor-icons/react'
import { Html, useProgress } from '@react-three/drei'

function Loading() {
  const state = useProgress()

  return (
    <Html center className="whitespace-nowrap animate-fade-in">
      {/* In dark mode the whole strip inverts: the greyscale background
          image reads fine as a negative, and the white card inside it
          comes out as the dark-mode card with no variants of its own. */}
      <div className="bg-[url('/images/loading-grey.jpg')] dark:invert animate-background w-screen py-28 flex items-center justify-center">
        <div className="font-mono text-xs space-x-4 flex items-center text-stone-700 bg-white px-4 py-4 rounded shadow pointer-events-none">
          <CircleNotch
            className="inline fill-stone-400 animate-spin"
            size={16}
          />
          <div>
            {state.loaded} / 20 assets
            <span className="hidden xs:inline"> fetched and</span> loaded
          </div>
        </div>
      </div>
    </Html>
  )
}

export default Loading
