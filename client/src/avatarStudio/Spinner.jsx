export default function Spinner({ className = '' }) {
  return (
    <span
      className={`inline-block size-5 rounded-full border-2 border-violet-500/30 border-t-violet-500 animate-spin ${className}`}
      aria-hidden
    />
  )
}
