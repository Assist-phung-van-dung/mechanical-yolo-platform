import {
  Activity,
  BarChart3,
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
  { id: 'batch', label: 'Batch Evaluation', icon: BarChart3 },
  { id: 'batchHistory', label: 'Batch History', icon: ClipboardCheck },
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

      <header className="sticky top-0 z-30 border-b border-white/10 bg-slate-950/75 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-[1900px] flex-col gap-3 px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-500 shadow-glow">
              <Layers3 className="h-6 w-6" />
            </div>
            <div className="min-w-[170px]">
              <div className="text-lg font-black tracking-tight">Mech YOLO</div>
              <div className="text-xs text-slate-400">PDF field extraction</div>
            </div>
          </div>

          <nav className="flex flex-1 gap-2 overflow-x-auto rounded-3xl border border-white/10 bg-white/[0.04] p-2">
            {navItems.map((item) => {
              const Icon = item.icon
              const active = activePage === item.id
              return (
                <button
                  key={item.id}
                  onClick={() => onChangePage(item.id)}
                  className={`group inline-flex shrink-0 items-center gap-2 rounded-2xl px-3 py-2 text-sm font-bold transition ${
                    active
                      ? 'bg-white text-slate-950 shadow-soft'
                      : 'text-slate-300 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </button>
              )
            })}
          </nav>

          <div className="hidden items-center gap-2 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-xs font-semibold text-cyan-100 2xl:flex">
            <Rocket className="h-4 w-4" />
            YOLO + OCR/Qwen production pipeline
          </div>
        </div>
      </header>

      <main className="relative z-10 min-h-screen">
        <div className="mx-auto max-w-[1900px] px-4 py-5">{children}</div>
      </main>
    </div>
  )
}
