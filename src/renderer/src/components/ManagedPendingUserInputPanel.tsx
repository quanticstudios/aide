import { Button, Input, Surface } from '@heroui/react'
import type { ChangeEvent } from 'react'

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
    <Surface
      className="mx-auto max-w-3xl rounded-xl border border-secondary/30 bg-secondary/5 px-4 py-3"
      data-testid={`managed-input-${request.id}`}
    >
      <p className="text-sm font-medium text-foreground">
        User input requested
      </p>
      <div className="mt-3 space-y-4">
        {request.questions.map((question) => (
          <div className="space-y-2" key={question.id}>
            {question.header ? (
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                {question.header}
              </p>
            ) : null}
            <p className="text-sm text-foreground">{question.prompt}</p>
            <div className="flex flex-wrap gap-2">
              {question.options.map((option) => {
                const selected = answers[question.id] === option.label

                return (
                  <Button
                    key={option.id}
                    onPress={() => onAnswerChange(question.id, option.label)}
                    size="sm"
                    variant={selected ? 'secondary' : 'ghost'}
                  >
                    {option.label}
                  </Button>
                )
              })}
            </div>
            <Input
              aria-label={`${question.prompt} answer`}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                onAnswerChange(question.id, event.target.value)
              }
              placeholder="Type a custom answer"
              value={answers[question.id] ?? ''}
              variant="secondary"
            />
          </div>
        ))}
      </div>
      <div className="mt-4">
        <Button
          isDisabled={isIncomplete}
          onPress={() => onSubmit(request.id)}
          size="sm"
          variant="primary"
        >
          Submit answers
        </Button>
      </div>
    </Surface>
  )
}
