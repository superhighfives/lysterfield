function Tooltip({
  text,
  placement = 'above',
}: {
  text: string
  placement?: 'above' | 'below'
}) {
  const position =
    placement === 'above'
      ? '-translate-y-[calc(50%_+_22px)] top-0 left-0'
      : 'top-full mt-1 left-1/2 -translate-x-1/2'

  return (
    <div
      className={`group-hover:opacity-100 whitespace-nowrap text-yellow-800 font-sans transition opacity-0 bg-yellow-400 text-sm px-2 py-1 rounded absolute pointer-events-none ${position}`}
    >
      {text}
    </div>
  )
}

export default Tooltip
