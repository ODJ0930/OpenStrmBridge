import type { LucideIcon, LucideProps } from 'lucide-react'
import {
  Activity,
  AlertTriangle,
  ArrowUp,
  Bot,
  CalendarClock,
  CheckCircle2,
  Copy,
  Database,
  ExternalLink,
  File,
  FileText,
  Folder,
  FolderOpen,
  Gauge,
  HardDrive,
  Info,
  Link2,
  ListTodo,
  LockKeyhole,
  LogIn,
  LogOut,
  Menu,
  Pencil,
  Play,
  Plug,
  Plus,
  Puzzle,
  RefreshCw,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  UserRound,
} from 'lucide-react'

import type { AppIconName } from '../types/ui'

const iconRegistry: Record<AppIconName, LucideIcon> = {
  tasks: ListTodo,
  storage: HardDrive,
  browser: FolderOpen,
  plugins: Puzzle,
  settings: Settings,
  arrowUp: ArrowUp,
  play: Play,
  stop: Square,
  edit: Pencil,
  copy: Copy,
  delete: Trash2,
  link: Link2,
  refresh: RefreshCw,
  menu: Menu,
  login: LogIn,
  logout: LogOut,
  lock: LockKeyhole,
  server: Server,
  file: File,
  folder: Folder,
  logs: FileText,
  plug: Plug,
  search: Search,
  external: ExternalLink,
  shield: ShieldCheck,
  bot: Bot,
  plus: Plus,
  info: Info,
  activity: Activity,
  alert: AlertTriangle,
  calendar: CalendarClock,
  check: CheckCircle2,
  database: Database,
  gauge: Gauge,
  sparkles: Sparkles,
  user: UserRound,
}

interface AppIconProps extends Omit<LucideProps, 'ref'> {
  name: AppIconName
}

export function AppIcon({ name, size = 16, strokeWidth = 1.8, ...props }: AppIconProps) {
  const Icon = iconRegistry[name]

  return (
    <Icon aria-hidden="true" focusable="false" size={size} strokeWidth={strokeWidth} {...props} />
  )
}
