// The six configuration files in the order a new project needs them. The Setup page
// walks this path; each editor shows the next step.
import type { Section } from '~/lib/types'

export type SectionInfo = {
  section: Section
  to: string
  title: string
  file: string
  purpose: string   // one sentence, for the Setup page
  intro: string     // two sentences at most, shown under the editor title
}

export const SECTIONS: SectionInfo[] = [
  {
    section: 'project', to: '/configure/project', title: 'Project', file: 'project.yaml',
    purpose: 'What you score and where it lives.',
    intro: 'The entity, warehouse and display settings.',
  },
  {
    section: 'sources', to: '/configure/sources', title: 'Sources', file: 'sources.yaml',
    purpose: 'Raw tables and their checks.',
    intro: 'Loaded on every run. A failed check stops the run.',
  },
  {
    section: 'scores', to: '/configure/scores', title: 'Scores', file: 'scores.yaml',
    purpose: 'SQL computed per entity.',
    intro: 'Aggregates or formulas over other scores, in any order.',
  },
  {
    section: 'segments', to: '/configure/segments', title: 'Segments', file: 'segments.yaml',
    purpose: 'Saved groups built from rules.',
    intro: 'Rules over scores and attributes.',
  },
  {
    section: 'model', to: '/configure/model', title: 'Semantic model', file: 'model.yaml',
    purpose: 'What the agent and SQL workspace can query.',
    intro: 'Only these tables can be queried. Descriptions guide the agent.',
  },
  {
    section: 'golden', to: '/configure/golden', title: 'Verified queries', file: 'golden.yaml',
    purpose: 'Questions with checked SQL.',
    intro: 'Matching questions are answered exactly, without a model.',
  },
]

export const sectionInfo = (section: Section): SectionInfo => SECTIONS.find((s) => s.section === section)!

export const nextSection = (section: Section): SectionInfo | undefined => {
  const i = SECTIONS.findIndex((s) => s.section === section)
  return SECTIONS[i + 1]
}

/** The engine's messages that belong to one section ("sources.2.path: ...", "segments.vip: ...", "key: ..."). */
export const sectionErrors = (errors: string[], section: Section): string[] =>
  errors.filter((e) => e.startsWith(section + '.') || e.startsWith(section + ':'))
