import { cn } from '../lib/utils'
import {
  THEME_OPTIONS,
  type ThemePreference,
  type ThemePreview,
} from '../lib/theme-preference'

interface ThemePickerProps {
  readonly onChange: (preference: ThemePreference) => void
  readonly value: ThemePreference
}

function ThemeThumbnail({ preview }: { readonly preview: ThemePreview }) {
  const bar = (width: string) => (
    <span
      className="block h-1 rounded-full"
      style={{ background: preview.bar, width }}
    />
  )
  return (
    <div
      aria-hidden
      className="flex aspect-[16/10] w-full overflow-hidden rounded-md"
      style={{ background: preview.canvas }}
    >
      <div className="flex w-[30%] flex-col gap-1.5 p-2 pt-2.5">
        {bar('70%')}
        {bar('55%')}
        {bar('62%')}
      </div>
      <div
        className="flex flex-1 flex-col justify-between p-2"
        style={{ background: preview.pane }}
      >
        <div className="flex flex-col gap-1.5 pt-0.5">
          {bar('60%')}
          {bar('80%')}
        </div>
        <div
          className="flex items-center justify-end rounded-sm p-1"
          style={{ background: preview.card }}
        >
          <span
            className="block size-2 rounded-full"
            style={{ background: preview.primary }}
          />
        </div>
      </div>
    </div>
  )
}

export default function ThemePicker({ onChange, value }: ThemePickerProps) {
  return (
    <div
      aria-label="Theme"
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
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
            <ThemeThumbnail preview={option.preview} />
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
