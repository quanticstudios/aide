import { Button } from '@heroui/react/button'
import { File, WandSparkles } from 'lucide-react'
import type { ManagedSessionAgentConfig } from '../../../shared/conversation-routing'
import type { ProviderSkill } from '../../../shared/provider-skills'
import { materialIconUrlForFile } from '../lib/material-file-icon'

interface RecipientMentionMenuProps {
  readonly activeIndex: number
  readonly agents: readonly ManagedSessionAgentConfig[]
  readonly filePaths: readonly string[]
  readonly isFileSearchLoading: boolean
  readonly onActiveIndexChange: (index: number) => void
  readonly onSelectAgent: (agent: ManagedSessionAgentConfig) => void
  readonly onSelectFile: (filePath: string) => void
  readonly onSelectSkill: (skill: ProviderSkill) => void
  readonly skills: readonly ProviderSkill[]
}

function selectionLabel(agent: ManagedSessionAgentConfig): string {
  const provider = agent.selection.mode === 'claude' ? 'Claude' : 'Codex'
  return agent.selection.model
    ? `${provider} · ${agent.selection.model}`
    : provider
}

function fileParts(filePath: string): { fileName: string; parentPath: string } {
  const separatorIndex = filePath.lastIndexOf('/')
  return separatorIndex < 0
    ? { fileName: filePath, parentPath: '.' }
    : {
        fileName: filePath.slice(separatorIndex + 1),
        parentPath: filePath.slice(0, separatorIndex),
      }
}

export default function RecipientMentionMenu({
  activeIndex,
  agents,
  filePaths,
  isFileSearchLoading,
  onActiveIndexChange,
  onSelectAgent,
  onSelectFile,
  onSelectSkill,
  skills,
}: RecipientMentionMenuProps) {
  return (
    <div
      aria-label="Mention suggestions"
      className="absolute bottom-full left-0 z-20 mb-2 w-full rounded-lg floating-surface"
      data-testid="managed-recipient-menu"
      role="listbox"
    >
      {agents.length > 0 ? (
        <>
          <div className="px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Agents
          </div>
          <div className="p-1 pt-0">
            {agents.map((agent, index) => (
              <div
                aria-selected={index === activeIndex}
                key={agent.alias}
                role="option"
                tabIndex={-1}
              >
                <Button
                  className={`flex h-auto w-full flex-col items-start gap-0 rounded-lg px-3 py-2 text-left transition-colors ${
                    index === activeIndex
                      ? 'bg-surface-tertiary text-foreground'
                      : 'text-foreground/80 hover:bg-surface-secondary'
                  }`}
                  onMouseEnter={() => onActiveIndexChange(index)}
                  onPress={() => onSelectAgent(agent)}
                  variant="ghost"
                >
                  <span className="font-semibold">@{agent.alias}</span>
                  <span className="text-xs text-muted-foreground">
                    {selectionLabel(agent)}
                  </span>
                </Button>
              </div>
            ))}
          </div>
        </>
      ) : null}
      {skills.length > 0 ? (
        <>
          <div className="border-t border-border/60 px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground first:border-t-0">
            Skills
          </div>
          <div className="p-1 pt-0">
            {skills.map((skill, skillIndex) => {
              const index = agents.length + skillIndex
              return (
                <div
                  aria-selected={index === activeIndex}
                  key={`${skill.provider}:${skill.id}`}
                  role="option"
                  tabIndex={-1}
                >
                  <Button
                    className={`flex h-8 w-full min-w-0 justify-start gap-2 rounded-md px-2 text-left transition-colors ${
                      index === activeIndex
                        ? 'bg-surface-tertiary text-foreground'
                        : 'text-foreground/80 hover:bg-surface-secondary'
                    }`}
                    onMouseEnter={() => onActiveIndexChange(index)}
                    onPress={() => onSelectSkill(skill)}
                    variant="ghost"
                  >
                    <WandSparkles
                      aria-hidden
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                    <span className="min-w-0 truncate font-medium">
                      /{skill.name}
                    </span>
                    <span className="min-w-0 truncate text-xs text-muted-foreground">
                      {skill.owner} · {skill.description}
                    </span>
                  </Button>
                </div>
              )
            })}
          </div>
        </>
      ) : null}
      <div className="border-t border-border/60 px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground first:border-t-0">
        Files
      </div>
      <div className="p-1 pt-0">
        {filePaths.map((filePath, fileIndex) => {
          const index = agents.length + skills.length + fileIndex
          const { fileName, parentPath } = fileParts(filePath)
          const iconUrl = materialIconUrlForFile(filePath)
          return (
            <div
              aria-selected={index === activeIndex}
              key={filePath}
              role="option"
              tabIndex={-1}
            >
              <Button
                className={`flex h-8 w-full min-w-0 justify-start gap-2 rounded-md px-2 text-left transition-colors ${
                  index === activeIndex
                    ? 'bg-surface-tertiary text-foreground'
                    : 'text-foreground/80 hover:bg-surface-secondary'
                }`}
                onMouseEnter={() => onActiveIndexChange(index)}
                onPress={() => onSelectFile(filePath)}
                variant="ghost"
              >
                {iconUrl ? (
                  <img alt="" className="size-4 shrink-0" src={iconUrl} />
                ) : (
                  <File aria-hidden className="size-4 shrink-0" />
                )}
                <span className="min-w-0 truncate font-medium">{fileName}</span>
                <span className="min-w-0 truncate text-xs text-muted-foreground">
                  {parentPath}
                </span>
              </Button>
            </div>
          )
        })}
        {!isFileSearchLoading && filePaths.length === 0 ? (
          <div className="px-3 py-2 text-xs text-muted-foreground">
            No matching files
          </div>
        ) : null}
        {isFileSearchLoading ? (
          <div className="px-3 py-2 text-xs text-muted-foreground">
            Searching files…
          </div>
        ) : null}
      </div>
    </div>
  )
}
