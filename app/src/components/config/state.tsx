// Config and pipeline-run state shared by every page.
//
// The server copy of the config is loaded once and refreshed after a save. Each editor
// keeps its own draft of one section; drafts are validated by the engine as you type
// (debounced), so the editor shows the same errors `scorebase validate` would.
import { useServerFn } from '@tanstack/react-start'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Config, Run, Section } from '~/lib/types'
import { getConfig, listRuns, saveSection, startRun, validateSection } from '~/server/config'
import { useDebounced } from '~/components/ui'

type ConfigState = { config: Config | null; error: string | null; reload: () => Promise<void> }
const ConfigCtx = createContext<ConfigState>({ config: null, error: null, reload: async () => {} })

type RunState = { latest: Run | null; runs: Run[]; start: (publish?: boolean) => Promise<string[] | null>; refresh: () => void }
const RunCtx = createContext<RunState>({ latest: null, runs: [], start: async () => null, refresh: () => {} })

export function AppState({ children }: { children: ReactNode }) {
  const fetchConfig = useServerFn(getConfig)
  const fetchRuns = useServerFn(listRuns)
  const begin = useServerFn(startRun)
  const [config, setConfig] = useState<Config | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [runs, setRuns] = useState<Run[]>([])

  const reload = useCallback(async () => {
    try {
      setConfig(await fetchConfig())
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [fetchConfig])

  const refresh = useCallback(() => {
    fetchRuns().then(setRuns).catch(() => {})
  }, [fetchRuns])

  useEffect(() => {
    reload()
    refresh()
  }, [reload, refresh])

  // Poll quickly while a run is going, slowly otherwise (a run may start from the CLI).
  const running = runs[0]?.status === 'running'
  useEffect(() => {
    const t = setInterval(refresh, running ? 1000 : 15_000)
    return () => clearInterval(t)
  }, [running, refresh])

  const start = useCallback(async (publish = true) => {
    const r = await begin({ data: { publish } })
    if ('errors' in r) return r.errors
    refresh()
    return null
  }, [begin, refresh])

  const runState = useMemo(() => ({ latest: runs[0] ?? null, runs, start, refresh }), [runs, start, refresh])
  return (
    <ConfigCtx.Provider value={{ config, error, reload }}>
      <RunCtx.Provider value={runState}>{children}</RunCtx.Provider>
    </ConfigCtx.Provider>
  )
}

export const useConfig = () => useContext(ConfigCtx)
export const useRuns = () => useContext(RunCtx)

export type SectionEditor<T> = {
  value: T | null
  set: (v: T | ((prev: T) => T)) => void
  dirty: boolean
  errors: string[]
  validating: boolean
  saving: boolean
  saved: boolean
  save: () => Promise<boolean>
  discard: () => void
}

export function useSection<S extends Section>(section: S): SectionEditor<Config[S]> {
  type T = Config[S]
  const { config, reload } = useConfig()
  const save = useServerFn(saveSection)
  const validate = useServerFn(validateSection)
  const server = (config?.[section] ?? null) as T | null
  const [draft, setDraft] = useState<T | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [validating, setValidating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const value = draft ?? server
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(server)

  // Validate drafts against the engine, including references to other sections.
  const pending = useDebounced(dirty ? draft : null, 350)
  const seq = useRef(0)
  useEffect(() => {
    if (pending === null) {
      setErrors(config?.errors.filter((e) => e.startsWith(section + '.') || e.startsWith(section + ':')) ?? [])
      return
    }
    const n = ++seq.current
    setValidating(true)
    validate({ data: { section, data: pending } })
      .then((r) => n === seq.current && setErrors(r.errors))
      .catch((e) => n === seq.current && setErrors([(e as Error).message]))
      .finally(() => n === seq.current && setValidating(false))
  }, [pending, section, validate, config])

  // Leaving the page with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  return {
    value,
    dirty,
    errors,
    validating,
    saving,
    saved,
    set: (v) => {
      setSaved(false)
      setDraft((prev) => (typeof v === 'function' ? (v as (p: T) => T)((prev ?? server) as T) : v))
    },
    discard: () => {
      setDraft(null)
      setErrors([])
    },
    save: async () => {
      if (!draft) return true
      setSaving(true)
      try {
        const r = await save({ data: { section, data: draft } })
        if (r.errors.length) {
          setErrors(r.errors)
          return false
        }
        await reload()
        setDraft(null)
        setSaved(true)
        return true
      } catch (e) {
        setErrors([(e as Error).message])
        return false
      } finally {
        setSaving(false)
      }
    },
  }
}
