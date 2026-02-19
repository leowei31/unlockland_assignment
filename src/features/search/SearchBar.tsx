import clsx from 'clsx'
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type KeyboardEventHandler,
} from 'react'
import type { SearchRecord } from '../../types/parcel'

function SearchIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

export interface SearchBarProps {
  value: string
  results: SearchRecord[]
  history: SearchRecord[]
  isFocused: boolean
  showHistory: boolean
  onChange: (value: string) => void
  onSelect: (item: SearchRecord, source: 'search' | 'history') => void
  onFocusChange: (focused: boolean) => void
  onClearHistory: () => void
}

type NavigationKey = 'ArrowDown' | 'ArrowUp' | 'Enter' | 'Escape' | null

function getNavigationKey(event: { key: string; code?: string; keyCode?: number; which?: number }) {
  if (
    event.key === 'ArrowDown' ||
    event.key === 'Down' ||
    event.code === 'ArrowDown' ||
    event.keyCode === 40 ||
    event.which === 40
  ) {
    return 'ArrowDown' as NavigationKey
  }
  if (
    event.key === 'ArrowUp' ||
    event.key === 'Up' ||
    event.code === 'ArrowUp' ||
    event.keyCode === 38 ||
    event.which === 38
  ) {
    return 'ArrowUp' as NavigationKey
  }
  if (
    event.key === 'Enter' ||
    event.code === 'Enter' ||
    event.keyCode === 13 ||
    event.which === 13
  ) {
    return 'Enter' as NavigationKey
  }
  if (
    event.key === 'Escape' ||
    event.key === 'Esc' ||
    event.code === 'Escape' ||
    event.keyCode === 27 ||
    event.which === 27
  ) {
    return 'Escape' as NavigationKey
  }
  return null
}

export function SearchBar({
  value,
  results,
  history,
  isFocused,
  showHistory,
  onChange,
  onSelect,
  onFocusChange,
  onClearHistory,
}: SearchBarProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const listboxId = useId()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const blurTimeoutRef = useRef<number | null>(null)
  const [isInputFocused, setIsInputFocused] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  const localShowHistory = value.trim().length === 0
  const effectiveShowHistory = showHistory || localShowHistory
  const visibleItems = useMemo(
    () => (effectiveShowHistory ? history : results),
    [effectiveShowHistory, history, results],
  )
  const hasFocus = isInputFocused || isFocused
  const isDropdownVisible = hasFocus && (effectiveShowHistory || visibleItems.length > 0)
  const normalizedActiveIndex =
    activeIndex >= 0 && activeIndex < visibleItems.length ? activeIndex : -1
  const activeItemId =
    normalizedActiveIndex >= 0 ? `${listboxId}-option-${normalizedActiveIndex}` : undefined

  const clearBlurTimeout = useCallback(() => {
    if (!blurTimeoutRef.current) return
    window.clearTimeout(blurTimeoutRef.current)
    blurTimeoutRef.current = null
  }, [])

  const closeDropdown = useCallback(() => {
    setIsInputFocused(false)
    onFocusChange(false)
  }, [onFocusChange])

  const keepOpen = useCallback(() => {
    clearBlurTimeout()
    setIsInputFocused(true)
    onFocusChange(true)
  }, [clearBlurTimeout, onFocusChange])

  const scheduleClose = useCallback(() => {
    clearBlurTimeout()
    blurTimeoutRef.current = window.setTimeout(() => {
      const activeElement = document.activeElement
      const rootElement = rootRef.current
      if (rootElement && activeElement && rootElement.contains(activeElement)) {
        blurTimeoutRef.current = null
        return
      }
      closeDropdown()
      blurTimeoutRef.current = null
    }, 80)
  }, [clearBlurTimeout, closeDropdown])

  useEffect(() => {
    optionRefs.current = optionRefs.current.slice(0, visibleItems.length)
  }, [visibleItems.length])

  const handleSelect = useCallback(
    (item: SearchRecord): void => {
      onSelect(item, effectiveShowHistory ? 'history' : 'search')
      inputRef.current?.blur()
    },
    [effectiveShowHistory, onSelect],
  )

  const handleNavigation = useCallback(
    (navigationKey: Exclude<NavigationKey, null>): boolean => {
      if (visibleItems.length === 0) {
        if (navigationKey === 'Escape') {
          inputRef.current?.blur()
          return true
        }
        return false
      }

      if (navigationKey === 'ArrowDown') {
        const nextIndex = normalizedActiveIndex < 0 ? 0 : (normalizedActiveIndex + 1) % visibleItems.length
        setActiveIndex(nextIndex)
        optionRefs.current[nextIndex]?.focus()
        return true
      }

      if (navigationKey === 'ArrowUp') {
        const nextIndex =
          normalizedActiveIndex < 0
            ? visibleItems.length - 1
            : (normalizedActiveIndex - 1 + visibleItems.length) % visibleItems.length
        setActiveIndex(nextIndex)
        optionRefs.current[nextIndex]?.focus()
        return true
      }

      if (navigationKey === 'Enter') {
        const target = visibleItems[normalizedActiveIndex] ?? visibleItems[0]
        if (target) {
          handleSelect(target)
          return true
        }
        return false
      }

      if (navigationKey === 'Escape') {
        inputRef.current?.blur()
        return true
      }

      return false
    },
    [handleSelect, normalizedActiveIndex, visibleItems],
  )

  const onInputKeyDown: KeyboardEventHandler<HTMLInputElement> = (event) => {
    const navigationKey = getNavigationKey(event)
    if (!navigationKey) return
    if (!handleNavigation(navigationKey)) return
    event.preventDefault()
    event.stopPropagation()
  }

  const onOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const navigationKey = getNavigationKey(event)
    if (!navigationKey) return

    if (navigationKey === 'ArrowDown') {
      const next = (index + 1) % visibleItems.length
      setActiveIndex(next)
      optionRefs.current[next]?.focus()
      event.preventDefault()
      event.stopPropagation()
      return
    }

    if (navigationKey === 'ArrowUp') {
      const next = (index - 1 + visibleItems.length) % visibleItems.length
      setActiveIndex(next)
      optionRefs.current[next]?.focus()
      event.preventDefault()
      event.stopPropagation()
      return
    }

    if (navigationKey === 'Escape') {
      inputRef.current?.focus()
      event.preventDefault()
      event.stopPropagation()
      return
    }

    if (navigationKey === 'Enter') {
      const item = visibleItems[index]
      if (!item) return
      event.preventDefault()
      event.stopPropagation()
      handleSelect(item)
    }
  }

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const rootElement = rootRef.current
      const target = event.target as Node | null
      if (!rootElement || !target) return
      if (rootElement.contains(target)) return
      clearBlurTimeout()
      closeDropdown()
    }

    window.addEventListener('pointerdown', onPointerDown, true)
    return () => window.removeEventListener('pointerdown', onPointerDown, true)
  }, [clearBlurTimeout, closeDropdown])

  useEffect(() => {
    return () => {
      clearBlurTimeout()
    }
  }, [clearBlurTimeout])

  return (
    <div ref={rootRef} className="relative flex-1">
      {/* Input */}
      <div className="relative flex items-center">
        <span className="absolute left-2.5 text-muted-soft pointer-events-none flex items-center">
          <SearchIcon />
        </span>
        <input
          ref={inputRef}
          value={value}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          className="w-full h-9 rounded-lg border border-border pl-8 pr-3 text-sm bg-surface text-foreground placeholder:text-muted-soft outline-none transition-[border-color,box-shadow] duration-150 focus:border-accent focus:ring-[3px] focus:ring-accent/20"
          placeholder="Search Vancouver address..."
          role="combobox"
          aria-expanded={isDropdownVisible}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-activedescendant={activeItemId}
          onChange={(event) => {
            setActiveIndex(-1)
            onChange(event.target.value)
          }}
          onKeyDown={onInputKeyDown}
          onFocus={() => {
            keepOpen()
            setActiveIndex(-1)
          }}
          onBlur={scheduleClose}
        />
      </div>

      {/* Dropdown */}
      {isDropdownVisible && (
        <div
          id={listboxId}
          className="absolute top-[calc(100%+5px)] left-0 right-0 bg-surface border border-border rounded-xl shadow-xl overflow-hidden z-50 animate-slide-down"
          role="listbox"
        >
          {/* History header */}
          {effectiveShowHistory && history.length > 0 && (
            <div className="flex justify-between items-center px-3 py-2 border-b border-border text-[0.72rem] font-semibold tracking-[0.06em] uppercase text-muted-soft">
              <span>Recent searches</span>
              <button
                type="button"
                className="border-none bg-transparent text-accent text-[0.8rem] font-medium cursor-pointer px-1.5 py-0.5 rounded hover:bg-accent/10 transition-colors"
                onClick={onClearHistory}
              >
                Clear history
              </button>
            </div>
          )}

          {/* Items */}
          {visibleItems.map((item, index) => (
            <button
              id={`${listboxId}-option-${index}`}
              key={`${item.id}-${effectiveShowHistory ? 'history' : 'result'}`}
              type="button"
              role="option"
              ref={(node) => {
                optionRefs.current[index] = node
              }}
              aria-selected={index === normalizedActiveIndex}
              className={clsx(
                'w-full border-none bg-transparent px-3 py-2.5 text-left text-[0.88rem] cursor-pointer text-foreground block transition-colors',
                index === normalizedActiveIndex ? 'bg-surface-hover' : 'hover:bg-surface-hover',
              )}
              onMouseEnter={() => setActiveIndex(index)}
              onFocus={() => {
                keepOpen()
                setActiveIndex(index)
              }}
              onBlur={scheduleClose}
              onKeyDown={(event) => onOptionKeyDown(event, index)}
              onMouseDown={(event) => {
                event.preventDefault()
                handleSelect(item)
              }}
            >
              {item.address}
            </button>
          ))}

          {/* Empty state */}
          {!effectiveShowHistory && visibleItems.length === 0 && (
            <div className="px-3 py-3.5 text-muted-soft text-[0.88rem] text-center">
              No matching addresses.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

