import { Button, Input } from '@heroui/react'
import type { ChangeEvent } from 'react'

import { cn } from '@/lib/utils'
import type { ManagedSessionPendingUserInput } from '../../../shared/managed-session'

interface ManagedPendingUserInputPanelProps {
  readonly answers: Record<string, string>
  readonly onAnswerChange: (questionId: string, value: string) => void
  readonly onSubmit: (requestId: string) => void
  readonly request: ManagedSessionPendingUserInput
}

export default function ManagedPendingUserInputPanel({
  answers,
  onAnswerChange,
  onSubmit,
  request,
}: ManagedPendingUserInputPanelProps) {
  const isIncomplete = request.questions.some(
    (question) => (answers[question.id] ?? '').trim().length === 0,
  )

  return (
    <div
      className="mx-auto w-full max-w-3xl rounded-2xl border border-border/60 bg-surface p-4"
      data-testid={`managed-input-${request.id}`}
    >
      {request.questions.map((question) => (
        <div key={question.id}>
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {question.header ?? 'Input Required'}
          </p>
          <p className="mt-1 text-sm font-semibold text-foreground">
            {question.prompt}
          </p>

          {question.options.length > 0 ? (
            <div className="mt-3 space-y-1">
              {question.options.map((option, optionIndex) => {
                const selected = answers[question.id] === option.label

                return (
                  <button
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                      selected
                        ? 'bg-primary/10 text-foreground'
                        : 'text-foreground/70 hover:bg-surface-secondary',
                    )}
                    key={option.id}
                    onClick={() => onAnswerChange(question.id, option.label)}
                    type="button"
                  >
                    <span className="shrink-0 text-muted-foreground">
                      {optionIndex + 1}
                    </span>
                    <span className="font-medium">{option.label}</span>
                  </button>
                )
              })}
            </div>
          ) : null}

          <Input
            aria-label={`${question.prompt} answer`}
            className="mt-3"
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              onAnswerChange(question.id, event.target.value)
            }
            placeholder="Type your own answer, or leave this blank to use the selected option"
            value={answers[question.id] ?? ''}
            variant="secondary"
          />
        </div>
      ))}

      <div className="mt-4 flex justify-end">
        <Button
          isDisabled={isIncomplete}
          onPress={() => onSubmit(request.id)}
          size="sm"
          variant="primary"
        >
          Submit answer
        </Button>
      </div>
    </div>
  )
}
