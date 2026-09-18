import { describe, expect, it } from 'vitest'

import type { ProviderSkill } from '../../../shared/provider-skills'
import { filterProviderSkills } from './managed-slash-commands'

const providerSkills: readonly ProviderSkill[] = [
  {
    description: 'Review a change with Claude.',
    id: 'claude:skill:review',
    name: 'review',
    owner: 'Claude',
    provider: 'claude',
  },
  {
    description: 'Build a release with Codex.',
    id: 'codex:skill:release',
    name: 'release',
    owner: 'Codex',
    provider: 'codex',
  },
]

describe('filterProviderSkills', () => {
  it('searches skill names, descriptions, and provider labels', () => {
    expect(filterProviderSkills(providerSkills, 'release')).toEqual([
      providerSkills[1],
    ])
    expect(filterProviderSkills(providerSkills, 'review a change')).toEqual([
      providerSkills[0],
    ])
    expect(filterProviderSkills(providerSkills, 'codex')).toEqual([
      providerSkills[1],
    ])
  })

  it('returns every provider skill for an empty query', () => {
    expect(filterProviderSkills(providerSkills, '')).toEqual(providerSkills)
  })
})

describe('skill search ranking', () => {
  it('ranks names above description matches and accepts word separators', () => {
    const skills: ProviderSkill[] = [
      {
        ...providerSkills[0],
        id: 'bootstrap',
        name: 'vercel:bootstrap',
        description: 'Uses pro-design for setup',
      },
      { ...providerSkills[0], id: 'longer', name: 'pro-design-review' },
      { ...providerSkills[0], id: 'design', name: 'pro-design' },
      { ...providerSkills[1], id: 'codex-design', name: 'pro-design' },
      {
        ...providerSkills[0],
        id: 'unrelated',
        name: 'release',
        description: 'Publish a release',
      },
    ]
    expect(
      filterProviderSkills(skills, 'pro-des').map((skill) => skill.id),
    ).toEqual(['longer', 'design', 'codex-design', 'bootstrap'])
    expect(
      filterProviderSkills(skills, 'pro design').map((skill) => skill.id),
    ).toEqual(['design', 'codex-design', 'longer', 'bootstrap'])
    expect(filterProviderSkills(skills, 'unmatched')).toEqual([])
  })
})
