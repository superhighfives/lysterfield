import { create } from 'zustand'
import { Dream } from './utils/types'
import { Vector2 } from 'three'

export interface AppState {
  dream: Dream | null
  resetting: boolean
  seeking: boolean
  collection: Dream[]
  /** Mirrors the native HTMLMediaElement.readyState scale (0=HAVE_NOTHING .. 4=HAVE_ENOUGH_DATA). */
  videoState: number
  videoPlaying: boolean
  isMobile: boolean
  isTouch: boolean
  polaroidVisible: number
  ready: boolean
  showPlayhead: boolean
  initialRotation: [number, number, number]
  globalPointer: Vector2
  resetInitialRotation: boolean
  isTooSlow: boolean
  setDream: (dream: Dream | null) => void
  setResetting: (resetting: boolean) => void
  setSeeking: (seeking: boolean) => void
  setCollection: (collection: Dream[]) => void
  setVideoState: (videoState: number) => void
  setVideoPlaying: (videoPlaying: boolean) => void
  setShowPlayhead: (showPlayhead: boolean) => void
  setIsMobile: (isMobile: boolean) => void
  setIsTouch: (isMobile: boolean) => void
  setPolaroidVisible: (polaroidVisible: number) => void
  setInitialRotation: (initialRotation: [number, number, number]) => void
  setResetInitialRotation: (resetInitialRotation: boolean) => void
  setGlobalPointer: (globalPointer: Vector2) => void
  setReady: (ready: boolean) => void
  setIsTooSlow: (ready: boolean) => void
}

export const useStore = create<AppState>()((set) => ({
  dream: null,
  resetting: false,
  seeking: false,
  collection: [],
  videoState: HTMLMediaElement.HAVE_NOTHING,
  videoPlaying: false,
  isMobile: false,
  isTouch: false,
  polaroidVisible: 0,
  ready: false,
  showPlayhead: false,
  initialRotation: [0, 0, 0],
  globalPointer: new Vector2(0, 0),
  resetInitialRotation: true,
  isTooSlow: false,
  setDream: (dream: Dream | null) => set({ dream }),
  setResetting: (resetting: boolean) => {
    set(() => ({ resetting }))
    if (resetting) {
      setTimeout(() => {
        set(() => ({ dream: null }))
        set(() => ({ resetting: false }))
      }, 1000)
    }
  },
  setCollection: (collection: Dream[]) => set({ collection }),
  setVideoState: (videoState) => set(() => ({ videoState })),
  setShowPlayhead: (showPlayhead: boolean) => set(() => ({ showPlayhead })),
  setVideoPlaying: (videoPlaying: boolean) => set(() => ({ videoPlaying })),
  setIsMobile: (isMobile: boolean) => set(() => ({ isMobile })),
  setIsTouch: (isTouch: boolean) => set(() => ({ isTouch })),
  setPolaroidVisible: (polaroidVisible: number) =>
    set(() => ({ polaroidVisible })),
  setInitialRotation: (initialRotation: [number, number, number]) =>
    set(() => ({ initialRotation })),
  setResetInitialRotation: (resetInitialRotation: boolean) =>
    set(() => ({ resetInitialRotation })),
  setGlobalPointer: (globalPointer: Vector2) => set(() => ({ globalPointer })),
  setReady: (ready: boolean) => set(() => ({ ready })),
  setIsTooSlow: (isTooSlow: boolean) => set(() => ({ isTooSlow })),
  setSeeking: (seeking: boolean) => set(() => ({ seeking })),
}))
