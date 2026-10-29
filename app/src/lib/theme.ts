// Light, dark, or follow the system. The choice is per browser (localStorage); the class
// is applied by an inline script before first paint so there's no flash of the wrong theme.
import { useCallback, useEffect, useState } from 'react'

export type ThemePref = 'system' | 'light' | 'dark'
const KEY = 'scorebase.theme'

export const THEME_SCRIPT = `(function(){try{var p=localStorage.getItem('${KEY}')||'system';var d=p==='dark'||(p==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d)}catch(e){}})()`

function apply(pref: ThemePref) {
  const dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}

export function useTheme(): [ThemePref, (p: ThemePref) => void] {
  const [pref, setPref] = useState<ThemePref>('system')
  useEffect(() => {
    try {
      setPref((localStorage.getItem(KEY) as ThemePref) || 'system')
    } catch {}
  }, [])
  useEffect(() => {
    if (pref !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const on = () => apply('system')
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [pref])
  const set = useCallback((p: ThemePref) => {
    setPref(p)
    try {
      localStorage.setItem(KEY, p)
    } catch {}
    apply(p)
  }, [])
  return [pref, set]
}
