import {
  forwardRef,
  HTMLProps,
  MutableRefObject,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useStore } from '../store'
import {
  Play,
  Pause,
  SpeakerSimpleX,
  SpeakerSimpleNone,
  SpeakerSimpleLow,
  SpeakerSimpleHigh,
  CameraRotate,
} from '@phosphor-icons/react'
import Tooltip from '../views/tooltip'

import {
  MediaController,
  MediaPlayButton,
  MediaMuteButton,
  MediaTimeDisplay,
  MediaTimeRange,
  MediaPreviewTimeDisplay,
} from 'media-chrome/react'
import Footer from '../views/footer'

const Playhead = forwardRef<HTMLVideoElement, HTMLProps<HTMLVideoElement>>(
  (_props, ref) => {
    const dream = useStore((state) => state.dream)
    const showPlayhead = useStore((state) => state.showPlayhead)
    const videoPlaying = useStore((state) => state.videoPlaying)
    const isMobile = useStore((state) => state.isMobile)
    const isTouch = useStore((state) => state.isTouch)
    const [recalibrateMobile, setRecalibrateMobile] = useState(false)

    const setResetInitialRotation = useStore(
      (state) => state.setResetInitialRotation
    )
    const polaroidVisible = useStore((state) => state.polaroidVisible)
    const setResetting = useStore((state) => state.setResetting)
    const setSeeking = useStore((state) => state.setSeeking)
    const setVideoPlaying = useStore((state) => state.setVideoPlaying)
    const setVideoState = useStore((state) => state.setVideoState)

    useEffect(() => {
      ;(ref as MutableRefObject<HTMLVideoElement>).current.load()
    }, [dream])

    // Syncs native <video> playback state into the store directly, rather
    // than through whichever library renders the visible controls — this
    // logic used to depend on @react-av's hooks; the native events it wraps
    // are the same ones every browser already fires, so reading them
    // directly means a future controls-library swap won't touch this again.
    useEffect(() => {
      const el = (ref as MutableRefObject<HTMLVideoElement>).current
      if (!el) return

      const updateReadyState = () => setVideoState(el.readyState)
      const handlePlaying = () => setVideoPlaying(true)
      const handlePause = () => setVideoPlaying(false)
      const handleEnded = () => setResetting(true)
      const handleSeeking = () => setSeeking(true)
      const handleSeeked = () => setSeeking(false)

      const readyStateEvents = [
        'loadedmetadata',
        'loadeddata',
        'canplay',
        'canplaythrough',
        'waiting',
        'stalled',
        'emptied',
      ]
      readyStateEvents.forEach((event) =>
        el.addEventListener(event, updateReadyState)
      )
      el.addEventListener('playing', handlePlaying)
      el.addEventListener('pause', handlePause)
      el.addEventListener('ended', handleEnded)
      el.addEventListener('seeking', handleSeeking)
      el.addEventListener('seeked', handleSeeked)

      updateReadyState()

      return () => {
        readyStateEvents.forEach((event) =>
          el.removeEventListener(event, updateReadyState)
        )
        el.removeEventListener('playing', handlePlaying)
        el.removeEventListener('pause', handlePause)
        el.removeEventListener('ended', handleEnded)
        el.removeEventListener('seeking', handleSeeking)
        el.removeEventListener('seeked', handleSeeked)
      }
    }, [])

    const recalibrateTimeout = useRef<ReturnType<typeof setTimeout> | null>(
      null
    )

    // Watches only `globalPointer` via a direct store subscription instead
    // of `useStore((state) => state.globalPointer)` — that field updates
    // every animation frame (see main.tsx), and a reactive subscription to
    // it re-rendered this entire control bar 60x/sec for a check that only
    // ever changes outcome a few times per session.
    useEffect(() => {
      const unsubscribe = useStore.subscribe((state, prevState) => {
        if (state.globalPointer === prevState.globalPointer) return
        const globalPointer = state.globalPointer

        const offCenter =
          globalPointer.x <= 0.33 ||
          globalPointer.x >= 1.67 ||
          globalPointer.y <= 0.33 ||
          globalPointer.y >= 1.67

        if (offCenter && isMobile) {
          if (!recalibrateMobile && !recalibrateTimeout.current) {
            recalibrateTimeout.current = setTimeout(
              () => setRecalibrateMobile(true),
              3000
            )
          }
        } else {
          if (recalibrateTimeout.current) {
            clearTimeout(recalibrateTimeout.current)
            recalibrateTimeout.current = null
          }

          if (recalibrateMobile) {
            setRecalibrateMobile(false)
          }
        }
      })
      return unsubscribe
    }, [isMobile, recalibrateMobile])

    return (
      <>
        <div
          className={`fixed z-10 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2`}
        >
          <button
            className={`whitespace-nowrap fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-1 rounded-md px-4 py-2 bg-yellow-400 active:bg-black active:text-white flex items-center gap-2 shadow-xl transition-opacity duration-500 ${
              showPlayhead && recalibrateMobile && polaroidVisible > 0.3
                ? ''
                : 'pointer-events-none opacity-0'
            }`}
            onClick={() => setResetInitialRotation(true)}
          >
            <CameraRotate className="inline" />
            <span className="font-serif text-lg">Reorient mobile</span>
          </button>
        </div>
        <div
          className={`fixed z-10 bottom-10 left-1/2 -translate-x-1/2 bg-white border border-yellow-400 rounded-lg xs:rounded-full shadow-xl transition-opacity ${
            showPlayhead && polaroidVisible > 0.3
              ? ''
              : 'pointer-events-none opacity-0'
          }`}
        >
          <MediaController className="contents">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption -- generated video has no dialogue/caption track to provide */}
            <video
              slot="media"
              ref={ref}
              muted={
                location.hostname === 'localhost' ||
                location.hostname === '127.0.0.1'
              }
              className="hidden"
              preload="auto"
              playsInline
              crossOrigin="anonymous"
            >
              <source
                src={
                  dream
                    ? `${import.meta.env.VITE_APP_DREAMS}/${dream!.id}/video${
                        isMobile || isTouch ? '-small' : ''
                      }.webm`
                    : `video/title.webm`
                }
                type="video/webm"
                key={dream ? `${dream!.id}-webm` : 'video-webm'}
              />
              <source
                src={
                  dream
                    ? `${import.meta.env.VITE_APP_DREAMS}/${dream!.id}/video${
                        isMobile || isTouch ? '-small' : ''
                      }.mov`
                    : `video/title.mov`
                }
                type="video/mp4"
                key={dream ? `${dream!.id}-mov` : 'video-mov'}
              />
            </video>
            <div className="flex flex-col xs:flex-row w-[calc(100vw-4rem)] max-w-[400px] left-4 right-4 xs:space-x-3 items-center">
              <div className="flex self-stretch justify-center border-b xs:border-r xs:border-b-0 border-yellow-500">
                <Footer />
                <div className="group flex relative">
                  <MediaMuteButton className="transition-colors hover:text-yellow-600 hover:bg-yellow-200 px-3 py-2">
                    <SpeakerSimpleX slot="off" />
                    <SpeakerSimpleLow slot="low" />
                    <SpeakerSimpleNone slot="medium" />
                    <SpeakerSimpleHigh slot="high" />
                  </MediaMuteButton>
                  <Tooltip text="Toggle mute" />
                </div>
                <div className="group flex relative">
                  <MediaPlayButton className="transition-colors hover:text-yellow-600 hover:bg-yellow-200 px-3 pr-4 py-2">
                    <Play slot="play" />
                    <Pause slot="pause" />
                  </MediaPlayButton>
                  <Tooltip text={videoPlaying ? 'Pause' : 'Play'} />
                </div>
              </div>
              <div className="flex w-full gap-2 items-center pl-3 xs:pl-0 pr-3 py-2 ">
                <MediaTimeDisplay className="font-mono text-xs" />
                <MediaTimeRange
                  className="grow h-4
                    [&::part(track)]:bg-slate-300/40 [&::part(track)]:rounded-full [&::part(track)]:h-2
                    [&::part(buffered)]:bg-slate-300/60 [&::part(buffered)]:rounded-full
                    [&::part(progress)]:bg-yellow-400 [&::part(progress)]:rounded-full
                    [&::part(thumb)]:bg-slate-50 [&::part(thumb)]:border [&::part(thumb)]:border-yellow-500 [&::part(thumb)]:w-4 [&::part(thumb)]:h-4 [&::part(thumb)]:rounded-full"
                >
                  <MediaPreviewTimeDisplay
                    slot="preview"
                    className="text-gray-400 font-mono bg-white text-xs px-2 rounded-full tracking-wider pointer-events-none"
                  />
                </MediaTimeRange>
              </div>
            </div>
          </MediaController>
        </div>
      </>
    )
  }
)

Playhead.displayName = 'Playhead'

export default Playhead
