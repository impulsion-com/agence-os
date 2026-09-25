import {
  Activity, Archive, ArrowUpDown, BadgeEuro, Bell, Briefcase, Building2, Calendar, ChartColumn, ChartGantt, Check,
  ChevronDown, ChevronRight, Circle, CircleCheck, Clapperboard, Code, Contact, Ellipsis, Euro, Eye, FileSignature,
  FileText, Filter, Folder, FolderKanban, Globe, Handshake, Heart, House, Inbox, Kanban, Layers, LayoutDashboard,
  LayoutGrid, Link, List, ListChecks, LogOut, Megaphone, MessageSquare, Monitor, Moon, MousePointerClick, Palette,
  PanelLeft, Paperclip, PenTool, Plug, Plus, Receipt, Repeat, Rocket, Search, Settings, Share2, ShoppingBag, Smartphone,
  Sparkles, Star, Sun, Table, Target, Trash2, TrendingUp, UserPlus, Users, X, Zap, type LucideIcon, type LucideProps,
} from "lucide-react";

// Icônes adressables par nom (projets, équipes, navigation stockés en base).
export const ICONS: Record<string, LucideIcon> = {
  activity: Activity, archive: Archive, "arrow-up-down": ArrowUpDown, "badge-euro": BadgeEuro, bell: Bell,
  briefcase: Briefcase, "building-2": Building2, calendar: Calendar, "chart-column": ChartColumn, "chart-gantt": ChartGantt,
  check: Check, "chevron-down": ChevronDown, "chevron-right": ChevronRight, circle: Circle, "circle-check": CircleCheck,
  clapperboard: Clapperboard, code: Code, contact: Contact, ellipsis: Ellipsis, euro: Euro, eye: Eye,
  "file-signature": FileSignature, "file-text": FileText, filter: Filter, folder: Folder, "folder-kanban": FolderKanban,
  globe: Globe, handshake: Handshake, heart: Heart, house: House, inbox: Inbox, kanban: Kanban, layers: Layers,
  "layout-dashboard": LayoutDashboard, "layout-grid": LayoutGrid, link: Link, list: List, "list-checks": ListChecks,
  "log-out": LogOut, megaphone: Megaphone, "message-square": MessageSquare, monitor: Monitor, moon: Moon,
  "mouse-pointer-click": MousePointerClick, palette: Palette, "panel-left": PanelLeft, paperclip: Paperclip,
  "pen-tool": PenTool, plug: Plug, plus: Plus, receipt: Receipt, repeat: Repeat, rocket: Rocket, search: Search,
  settings: Settings, "share-2": Share2, "shopping-bag": ShoppingBag, smartphone: Smartphone, sparkles: Sparkles,
  star: Star, sun: Sun, table: Table, target: Target, "trash-2": Trash2, "trending-up": TrendingUp,
  "user-plus": UserPlus, users: Users, x: X, zap: Zap,
};

export function Icon({ name, size = 16, ...rest }: { name: string; size?: number } & Omit<LucideProps, "ref">) {
  const C = ICONS[name] ?? Folder;
  return <C size={size} strokeWidth={1.8} aria-hidden {...rest} />;
}
