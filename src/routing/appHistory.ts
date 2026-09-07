import type { AppSection } from '../components/BottomNavigation/BottomNavigation'

const ROUTE_REDIRECT_KEY = 'eds-diary-route-redirect'

const SECTION_SEGMENTS: Record<AppSection, string> = {
  pain: 'schmerzen',
  medication: 'medikamente',
  activity: 'aktivitaeten',
  configuration: 'konfiguration',
}

function basePath(): string {
  const base = import.meta.env.BASE_URL
  return base === '/' ? '' : base.replace(/\/$/, '')
}

export function pathForSection(section: AppSection): string {
  return `${basePath()}/${SECTION_SEGMENTS[section]}`
}

export function sectionFromPathname(pathname: string): AppSection {
  const base = basePath()
  const relativePath =
    base && pathname.startsWith(base)
      ? pathname.slice(base.length)
      : pathname
  const segment = relativePath.replace(/^\/+|\/+$/g, '')

  for (const [section, routeSegment] of Object.entries(SECTION_SEGMENTS)) {
    if (segment === routeSegment) return section as AppSection
  }

  return 'pain'
}

export function restoreGitHubPagesRoute(): void {
  try {
    const redirectedPath = window.sessionStorage.getItem(ROUTE_REDIRECT_KEY)
    if (!redirectedPath) return

    window.sessionStorage.removeItem(ROUTE_REDIRECT_KEY)

    const base = basePath()
    const expectedPrefix = base ? `${base}/` : '/'
    if (!redirectedPath.startsWith(expectedPrefix)) return

    window.history.replaceState(
      window.history.state,
      '',
      redirectedPath,
    )
  } catch {
    // Routing still works when sessionStorage is unavailable.
  }
}
