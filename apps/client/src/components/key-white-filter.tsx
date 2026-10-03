// An SVG filter, applied in CSS as `filter: url(#key-white)`, that turns a
// white background transparent, for artwork shot on white (the welcome
// splash video, the loading strip) so it can sit on any page background.
// Rendered once at the top of the app so it's available on every screen.
//
// Steps:
// 1. `alpha`: coverage from inverted brightness, 4 * (2.88 - r - g - b).
//    The zero point is the loading strip's background exactly (#f5f5f5,
//    r+g+b = 2.88), so it and anything whiter — the splash's white,
//    encoder noise — goes fully transparent. The slope is steep because
//    both pieces of artwork have a lot of pale lettering just under that
//    (#d8d8d8-#f0f0f0): a gentler curve either left the background as a
//    faint band or keyed those parts of the letters away.
// 2. Un-mix the white. An anti-aliased edge pixel is
//    `coverage * letter + (1 - coverage) * white`, so keying alone left
//    those edges near-white — a frosty rim against a dark page. The letter's
//    premultiplied colour is `pixel + coverage - 1`, which is exactly what
//    the arithmetic composite computes (k2 * source + k3 * alpha + k4), with
//    the coverage carried as white-at-that-alpha.
//
// Between them, the coverage is choked by a pixel. A brightness key can't
// tell a dark shape's soft edge from a pale shape's body: where the
// splash's dark tree silhouettes meet the white, a 30%-coverage edge pixel
// is light grey, which step 1 reads as fully opaque, so step 2 can't un-mix
// it and it showed as a thin light rim. Eroding the coverage drops that
// outermost ring (which then un-mixes to nothing) without touching the
// shapes' interiors.
function KeyWhiteFilter() {
  return (
    <svg className="absolute w-0 h-0" aria-hidden="true">
      {/* Region clipped to the element itself (the default pads it 10%):
          Chrome's arithmetic composite painted that padding opaque black. */}
      <filter
        id="key-white"
        colorInterpolationFilters="sRGB"
        x="0"
        y="0"
        width="1"
        height="1"
      >
        <feColorMatrix
          in="SourceGraphic"
          type="matrix"
          values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  -4 -4 -4 11.52 0"
          result="alpha"
        />
        <feMorphology
          in="alpha"
          operator="erode"
          radius="1"
          result="choked"
        />
        <feComposite
          in="SourceGraphic"
          in2="choked"
          operator="arithmetic"
          k1="0"
          k2="1"
          k3="1"
          k4="-1"
        />
      </filter>
    </svg>
  )
}

export default KeyWhiteFilter
