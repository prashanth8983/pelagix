// The frame every config page shares: title, live validation, a YAML view that can be
// edited directly, saved versions to restore, and a floating save bar.
import { useServerFn } from '@tanstack/react-start'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowRight, History as HistoryIcon, RotateCcw } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import YAML from 'yaml'
import type { Section } from '~/lib/types'
import { sectionHistory } from '~/server/config'
import { useToast } from '~/components/ui/Toaster'
import { Badge, Button, Code, Empty, ErrorList, PageHeader, Skeleton, Spinner, Tabs } from '~/components/ui'
import { nextSection, sectionInfo } from './sections'
import { useRuns, type SectionEditor } from './state'

const FILES: Record<Section, string> = {
  project: 'project.yaml', sources: 'sources.yaml', scores: 'scores.yaml',
  segments: 'segments.yaml', model: 'model.yaml', golden: 'golden.yaml',
}

export function SectionFrame<T>({ section, title, description, editor, actions, children }: {
  section: Section
  title: string
  /** Shown under the title. Defaults to the section's intro from sections.ts. */
  description?: ReactNode
  editor: SectionEditor<T>
  actions?: ReactNode
  children: ReactNode
}) {
  const info = sectionInfo(section)
  const next = nextSection(section)
  const [view, setView] = useState<'form' | 'yaml' | 'history'>('form')
  const { start } = useRuns()
  const toast = useToast()
  const navigate = useNavigate()

  const save = async () => {
    if (!(await editor.save())) return
    toast({
      title: `Saved ${FILES[section]}`,
      description: 'Run the pipeline to apply it.',
      tone: 'success',
      action: {
        label: 'Run pipeline',
        onClick: async () => {
          const errs = await start()
          if (errs) toast({ title: 'Run not started', description: errs.join('; '), tone: 'danger' })
          else navigate({ to: '/runs' })
        },
      },
    })
  }

  if (editor.value == null) {
    return <div className="space-y-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-64" /></div>
  }

  return (
    <div className="pb-24">
      <PageHeader
        title={title}
        description={
          <>
            <span>{description || info.intro}</span>
            <span className="ml-2 font-mono text-[11px] text-faint">{info.file}</span>
          </>
        }
        actions={
          <>
            {view === 'form' && actions}
            <Tabs value={view} onChange={setView} options={[
              { value: 'form', label: 'Editor' }, { value: 'yaml', label: 'YAML' }, { value: 'history', label: 'History' },
            ]} />
            {next && (
              <Link to={next.to} className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[13px] text-muted hover:bg-hover hover:text-fg">
                Next: {next.title} <ArrowRight className="size-3.5" />
              </Link>
            )}
          </>
        }
      />

      {view === 'form' && children}
      {view === 'yaml' && <YamlEditor value={editor.value} onApply={(v) => editor.set(v as T)} file={FILES[section]} />}
      {view === 'history' && <History section={section} onRestore={(v) => { editor.set(v as T); setView('form') }} />}

      {editor.errors.length > 0 && <div className="mt-5"><ErrorList errors={editor.errors} /></div>}

      {(editor.dirty || editor.saving) && (
        <div className="anim-rise fixed bottom-5 left-1/2 z-30 -translate-x-1/2 lg:ml-[calc(var(--sidebar-w,15rem)/2)]">
          <div className="flex items-center gap-4 rounded-lg border border-line bg-surface py-2 pl-4 pr-2 shadow-xl">
            <div className="flex items-center gap-2 text-[13px]">
              <span className="size-1.5 rounded-full bg-warning" />
              <span>Unsaved changes</span>
              {editor.validating ? <Spinner className="size-3.5" />
                : editor.errors.length ? <Badge tone="danger">{editor.errors.length} problem{editor.errors.length > 1 ? 's' : ''}</Badge>
                : <Badge tone="success">Valid</Badge>}
            </div>
            <div className="flex gap-1.5">
              <Button variant="ghost" onClick={editor.discard}>Discard</Button>
              <Button variant="primary" loading={editor.saving} disabled={editor.errors.length > 0 || editor.validating} onClick={save}>
                Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function YamlEditor({ value, onApply, file }: { value: unknown; onApply: (v: unknown) => void; file: string }) {
  const text = YAML.stringify(value, { lineWidth: 100, blockQuote: 'literal' })
  const [draft, setDraft] = useState(text)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => setDraft(text), [text])

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-card">
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <span className="font-mono text-[12px] text-muted">{file}</span>
          <div className="flex gap-1.5">
            <Button size="sm" variant="ghost" disabled={draft === text} onClick={() => setDraft(text)}>Reset</Button>
            <Button
              size="sm"
              variant="primary"
              disabled={draft === text}
              onClick={() => {
                try {
                  onApply(YAML.parse(draft))
                  setErr(null)
                } catch (e) {
                  setErr((e as Error).message)
                }
              }}
            >
              Apply to editor
            </Button>
          </div>
        </div>
        <Code value={draft} onChange={(e) => setDraft(e.target.value)} rows={Math.min(36, draft.split('\n').length + 2)}
          className="rounded-none border-0 focus:ring-0" />
      </div>
      {err && <p className="font-mono text-[12px] text-danger">{err}</p>}
      <p className="text-[12px] text-faint">Nothing is saved until you press Save.</p>
    </div>
  )
}

function History({ section, onRestore }: { section: Section; onRestore: (v: unknown) => void }) {
  const fetchHistory = useServerFn(sectionHistory)
  const [items, setItems] = useState<{ id: string; saved_at: string; text: string }[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => {
    fetchHistory({ data: { section } }).then(setItems).catch(() => setItems([]))
  }, [section, fetchHistory])

  if (!items) return <Skeleton className="h-40" />
  if (!items.length) {
    return <Empty icon={<HistoryIcon />} title="No earlier versions">Previous versions appear here after you save.</Empty>
  }
  const when = (s: string) => new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}`).toLocaleString()
  return (
    <div className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface shadow-card">
      {items.map((h) => (
        <div key={h.id}>
          <div className="flex items-center justify-between gap-3 px-4 py-2.5">
            <button onClick={() => setOpen(open === h.id ? null : h.id)} className="text-left text-[13px] hover:text-accent">
              Version replaced {when(h.saved_at)}
            </button>
            <Button size="sm" icon={<RotateCcw />} onClick={() => onRestore(YAML.parse(h.text))}>Restore</Button>
          </div>
          {open === h.id && <pre className="max-h-80 overflow-auto border-t border-line bg-subtle p-4 font-mono text-[12px]">{h.text}</pre>}
        </div>
      ))}
    </div>
  )
}
