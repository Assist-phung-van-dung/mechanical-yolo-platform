import {
  Activity,
  Boxes,
  BrainCircuit,
  Database,
  FileSearch,
  FileStack,
  PencilRuler,
  ClipboardCheck,
  Layers3,
  Rocket,
} from 'lucide-react'

const navItems = [
  { id: 'dashboard', label: 'Overview', icon: Activity },
  { id: 'library', label: 'PDF Library', icon: FileStack },
  { id: 'label', label: 'Label Workspace', icon: PencilRuler },
  { id: 'review', label: 'Review Labeled', icon: ClipboardCheck },
  { id: 'demo', label: 'PDF Demo', icon: FileSearch },
  { id: 'dataset', label: 'Dataset', icon: Database },
  { id: 'train', label: 'Training', icon: BrainCircuit },
  { id: 'models', label: 'Models', icon: Boxes },
]

export default function Layout({ activePage, onChangePage, children }) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-32 left-1/4 h-96 w-96 rounded-full bg-blue-500/20 blur-3xl" />
        <div className="absolute top-1/3 right-0 h-96 w-96 rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="absolute bottom-0 left-0 h-80 w-80 rounded-full bg-violet-500/10 blur-3xl" />
      </div>

      <aside className="fixed left-0 top-0 z-20 hidden h-full w-72 border-r border-white/10 bg-slate-950/70 p-5 backdrop-blur-xl lg:block">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-500 shadow-glow">
            <Layers3 className="h-6 w-6" />
          </div>
          <div>
            <div className="text-lg font-bold tracking-tight">Mech YOLO</div>
            <div className="text-xs text-slate-400">PDF field extraction</div>
          </div>
        </div>

        <nav className="space-y-2">
          {navItems.map((item) => {
            const Icon = item.icon
            const active = activePage === item.id
            return (
              <button
                key={item.id}
                onClick={() => onChangePage(item.id)}
                className={`group flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm transition ${
                  active
                    ? 'bg-white text-slate-950 shadow-soft'
                    : 'text-slate-300 hover:bg-white/10 hover:text-white'
                }`}
              >
                <Icon className="h-5 w-5" />
                <span className="font-medium">{item.label}</span>
              </button>
            )
          })}
        </nav>

        <div className="absolute bottom-5 left-5 right-5 rounded-3xl border border-white/10 bg-white/5 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
            <Rocket className="h-4 w-4 text-cyan-300" />
            Production path
          </div>
          <p className="text-xs leading-5 text-slate-400">
            Review labels, pre-label with YOLO, build clean datasets, train stronger models, and expose a production API.
          </p>
        </div>
      </aside>

      <main className="relative z-10 min-h-screen lg:pl-72">
        <div className="mx-auto px-4 py-5">
          <div className="mb-5 flex gap-2 overflow-x-auto rounded-3xl border border-white/10 bg-white/5 p-2 backdrop-blur-xl lg:hidden">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => onChangePage(item.id)}
                className={`whitespace-nowrap rounded-2xl px-4 py-2 text-sm ${
                  activePage === item.id ? 'bg-white text-slate-950' : 'text-slate-300'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          {children}
        </div>
      </main>
    </div>
  )
}
