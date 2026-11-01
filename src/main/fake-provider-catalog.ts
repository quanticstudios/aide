import type {
  ProviderCapabilitiesSnapshot,
  ProviderModelCapability,
} from '../shared/provider-capabilities'
import type { SkillFile } from './provider-skill-scan'

/** True when e2e asks for fake providers, so the composer offers the fixed models and skills the specs expect. */
export function isFakeProviderCatalogEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return ['1', 'fail-start', 'missing-cli'].includes(
    env.AIDE_FAKE_MANAGED_PROVIDERS ?? '',
  )
}

const claudeEfforts = [
  {
    description: 'Minimal thinking, fastest response',
    id: 'low',
    label: 'Low',
  },
  { description: 'Moderate thinking', id: 'medium', label: 'Medium' },
  { description: 'Deep reasoning', id: 'high', label: 'High' },
  { description: 'Maximum effort', id: 'max', label: 'Max' },
]

function fakeClaudeModel(
  id: string,
  label: string,
  description: string,
  isDefault: boolean,
): ProviderModelCapability {
  return {
    aliases: [],
    defaultReasoningEffort: 'high',
    defaultServiceTier: null,
    description,
    id,
    isDefault,
    label,
    reasoningEfforts: claudeEfforts,
    serviceTiers: [],
  }
}

// The catalog the removed provider capability service built from its fake providers (ENG-2898).
export const FAKE_PROVIDER_CAPABILITIES: ProviderCapabilitiesSnapshot = {
  providers: {
    claude: {
      defaultModelId: 'claude-sonnet-5',
      error: null,
      models: [
        fakeClaudeModel(
          'claude-sonnet-5',
          'Claude Sonnet 5',
          'Fake Claude model for end-to-end tests.',
          true,
        ),
        fakeClaudeModel(
          'claude-opus-5',
          'Claude Opus 5',
          'Second fake Claude model for end-to-end tests.',
          false,
        ),
      ],
      provider: 'claude',
      version: null,
    },
    codex: {
      defaultModelId: 'gpt-5.6-terra',
      error: null,
      models: [
        {
          aliases: [],
          defaultReasoningEffort: 'medium',
          defaultServiceTier: 'priority',
          description: 'Fake Codex model for end-to-end tests.',
          id: 'gpt-5.6-terra',
          isDefault: true,
          label: 'GPT-5.6 Terra',
          reasoningEfforts: [
            { description: 'Fast responses.', id: 'low', label: 'Low' },
            {
              description: 'Balanced reasoning.',
              id: 'medium',
              label: 'Medium',
            },
            { description: 'Thorough reasoning.', id: 'high', label: 'High' },
          ],
          serviceTiers: [
            {
              description: 'Higher priority processing.',
              id: 'priority',
              label: 'Fast',
            },
          ],
        },
      ],
      provider: 'codex',
      version: null,
    },
  },
}

export const FAKE_SKILL_FILES: readonly SkillFile[] = [
  {
    skill: {
      description: 'Fake Claude skill for end-to-end tests.',
      id: 'claude:skill:claude-test-skill',
      name: 'claude-test-skill',
      owner: 'Claude',
      provider: 'claude',
    },
  },
  {
    path: '/tmp/aide-fake-codex-test-skill/SKILL.md',
    skill: {
      description: 'Fake Codex skill for end-to-end tests.',
      id: 'codex:skill:eafb4a4ea8096486',
      name: 'codex-test-skill',
      owner: 'Codex',
      provider: 'codex',
    },
  },
]
