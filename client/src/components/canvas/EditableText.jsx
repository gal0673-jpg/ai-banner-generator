import { useEffect, useRef } from 'react'

export default function EditableText({
  className,
  style,
  text,
  resetKey,
  onTextChange,
  dir = 'rtl',
  as = 'div',
}) {
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const next = text ?? ''
    if (el.textContent !== next) el.textContent = next
  }, [text, resetKey])

  const emit = (el) => {
    onTextChange?.(el.textContent ?? '')
  }

  const common = {
    ref,
    dir,
    className,
    style,
    contentEditable: true,
    suppressContentEditableWarning: true,
    spellCheck: false,
    onMouseDown: (e) => e.stopPropagation(),
    onInput: (e) => emit(e.currentTarget),
    onBlur: (e) => emit(e.currentTarget),
  }

  return as === 'span' ? <span {...common} /> : <div {...common} />
}
