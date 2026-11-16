import {
  Activity,
  ArrowRight,
  Check,
  ChevronDown,
  CircleAlert,
  CirclePlay,
  Clock,
  Download,
  FileText,
  History,
  Layers,
  LayoutDashboard,
  ListChecks,
  ListOrdered,
  Mail,
  Menu,
  Monitor,
  Moon,
  MoreHorizontal,
  Network,
  PlugZap,
  Printer,
  Repeat,
  ScanLine,
  ShieldCheck,
  SunMedium,
  Usb,
  UserPlus,
  Users,
  Workflow,
  X,
  Zap,
} from 'lucide-react'

/**
 * String keys used by src/data/content.js -> Lucide components.
 * Named imports keep the bundle to the icons actually referenced.
 * Add a line here when you add an `icon:` value to the content file.
 */
const registry = {
  activity: Activity,
  'arrow-right': ArrowRight,
  check: Check,
  'chevron-down': ChevronDown,
  clock: Clock,
  close: X,
  dashboard: LayoutDashboard,
  dots: MoreHorizontal,
  download: Download,
  file: FileText,
  'file-text': FileText,
  history: History,
  layers: Layers,
  'list-checks': ListChecks,
  'list-ordered': ListOrdered,
  mail: Mail,
  menu: Menu,
  monitor: Monitor,
  moon: Moon,
  network: Network,
  'network-warnings': CircleAlert,
  play: CirclePlay,
  plug: PlugZap,
  printer: Printer,
  repeat: Repeat,
  scan: ScanLine,
  shield: ShieldCheck,
  sun: SunMedium,
  usb: Usb,
  'user-plus': UserPlus,
  users: Users,
  workflow: Workflow,
  zap: Zap,
}

export default function Icon({ name, size = 20, className = '', strokeWidth = 1.75 }) {
  const Glyph = registry[name]
  if (!Glyph) return null
  // Every icon on this page sits next to its own text label, so it is decorative.
  return (
    <Glyph
      aria-hidden="true"
      focusable="false"
      size={size}
      strokeWidth={strokeWidth}
      className={className}
    />
  )
}
