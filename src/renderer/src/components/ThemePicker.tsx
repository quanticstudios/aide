import { cn } from '../lib/utils'
import {
  type Palette,
  THEME_OPTIONS,
  type ThemePreference,
} from '../lib/theme-preference'

interface ThemePickerProps {
  readonly onChange: (preference: ThemePreference) => void
  readonly value: ThemePreference
}

// why: data-palette scopes the palette's tokens to the thumbnail, so it paints with the real colors.
function ThemeThumbnail({ palette }: { readonly palette: Palette }) {
  const bar = (width: string) => (
    <span className="block h-1 rounded-full bg-surface-4" style={{ width }} />
  )
  return (
    <div
      className="flex h-full min-w-0 flex-1 bg-background"
      data-palette={palette}
    >
      <div className="flex w-[30%] flex-col gap-1.5 p-2 pt-2.5">
        {bar('70%')}
        {bar('55%')}
        {bar('62%')}
      </div>
      <div className="flex flex-1 flex-col justify-between bg-surface-1 p-2">
        <div className="flex flex-col gap-1.5 pt-0.5">
          {bar('60%')}
          {bar('80%')}
        </div>
        <div className="flex items-center justify-end rounded-sm bg-surface-2 p-1">
          <span className="block size-2 rounded-full bg-primary" />
        </div>
      </div>
    </div>
  )
}

export default function ThemePicker({ onChange, value }: ThemePickerProps) {
  return (
    <div
      aria-label="Theme"
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      role="radiogroup"
    >
      {THEME_OPTIONS.map((option) => {
        const isSelected = option.id === value
        return (
          <button
            aria-checked={isSelected}
            className={cn(
              'flex cursor-pointer flex-col gap-2 rounded-lg border p-2 text-left transition-colors',
              isSelected
                ? 'border-primary ring-1 ring-primary'
                : 'border-border hover:border-[var(--border-strong)]',
            )}
            key={option.id}
            onClick={() => onChange(option.id)}
            role="radio"
            type="button"
          >
            <div
              aria-hidden
              className="flex aspect-[16/10] w-full overflow-hidden rounded-md"
            >
              {option.id === 'system' ? (
                <>
                  <ThemeThumbnail palette="light" />
                  <ThemeThumbnail palette="dark" />
                </>
              ) : (
                <ThemeThumbnail palette={option.id} />
              )}
            </div>
            <span className="px-1 pb-0.5">
              <span className="block text-[13px] font-medium leading-5 text-foreground">
                {option.label}
              </span>
              <span className="block text-[12px] leading-4 text-muted-foreground">
                {option.hint}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
