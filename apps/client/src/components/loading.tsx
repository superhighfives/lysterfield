import { CircleNotch } from '@phosphor-icons/react'
import { Html, useProgress } from '@react-three/drei'

function Loading() {
  const state = useProgress()

  return (
    <Html center className="whitespace-nowrap animate-fade-in">
      <div className="relative w-screen py-28 flex items-center justify-center">
        {/* The strip's lettering is shot on white; keying that white out
            (components/key-white-filter.tsx) lets it sit on the page's
            background gradient in either mode, rather than as a solid
            band. On its own layer so the card isn't filtered too. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[url('/images/loading-grey.jpg')] animate-background [filter:url(#key-white)]"
        />
        <div className="relative font-mono text-xs space-x-4 flex items-center text-stone-700 bg-white dark:text-stone-300 dark:bg-stone-900 px-4 py-4 rounded shadow pointer-events-none">
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
