import { useEffect, useState } from 'react'
import { CheckCircle2, Cpu, Database, FileImage, PencilRuler, ScanText, ShieldCheck } from 'lucide-react'
import { apiGet, fieldNames } from '../api/client'
import { Badge, Card, PageHeader } from '../components/UI'

export default function Dashboard() {
  const [health, setHealth] = useState(null)
  const [stats, setStats] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([apiGet('/api/health'), apiGet('/api/library/stats')])
      .then(([h, s]) => { setHealth(h); setStats(s) })
      .catch((err) => setError(err.message))
  }, [])

  return (
    <div>
      <PageHeader
        eyebrow="Mechanical AI Platform"
        title="PDF review, labeling, training, and extraction cockpit"
        description="A production-minded workflow for importing PDFs/CVAT labels, rendering pages at a fixed DPI, reviewing labels, pre-labeling with YOLO, building clean datasets, training models, and exposing a stable extraction API."
      />

      {error && <Card className="mb-5 border-rose-400/30 text-rose-200">Backend error: {error}</Card>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Metric icon={Cpu} label="Backend" value={health?.status || 'checking'} tone="green" />
        <Metric icon={ShieldCheck} label="Active model" value={health?.model_loaded ? 'ready' : 'missing'} tone={health?.model_loaded ? 'green' : 'yellow'} />
        <Metric icon={FileImage} label="Rendered pages" value={stats?.rendered_pages ?? 0} tone="blue" />
        <Metric icon={PencilRuler} label="Confirmed labels" value={stats?.confirmed_pages ?? 0} tone="green" />
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-black text-white">Active learning pipeline</h2>
            <Badge tone="blue">v2 workflow</Badge>
          </div>
          <div className="grid gap-3 md:grid-cols-5">
            {['Import PDF/CVAT', 'Render PNG', 'Pre-label', 'Human confirm', 'Build dataset'].map((item, index) => (
              <div key={item} className="rounded-3xl border border-white/10 bg-slate-950/50 p-4">
                <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-2xl bg-white text-sm font-black text-slate-950">{index + 1}</div>
                <div className="text-sm font-bold text-white">{item}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <h2 className="mb-4 text-xl font-black text-white">YOLO classes</h2>
          <div className="space-y-2">
            {fieldNames.map((name, idx) => (
              <div key={name} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
                <span className="text-sm text-slate-200">{name}</span>
                <span className="rounded-full bg-white px-2 py-1 text-xs font-black text-slate-950">{idx}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-xl font-black text-white">Recommended workflow</h2>
          <ol className="grid gap-3 text-sm text-slate-300">
            <Step text="Copy your old CVAT train/images + train/labels to runtime/imports/cvat-export and import it from PDF Library." />
            <Step text="Set the true CVAT class order before importing, so old labels become correct annotation JSON." />
            <Step text="Use Label Workspace random queues to review missing/low-confidence pages instead of labeling from zero." />
            <Step text="Build a dataset from confirmed labels, train v2, then test on PDF Demo/API." />
          </ol>
        </Card>

        <Card>
          <h2 className="mb-3 text-xl font-black text-white">Production API</h2>
          <div className="rounded-2xl bg-slate-950 p-4 font-mono text-xs leading-6 text-slate-300">
            POST /api/v1/extract-fields<br />
            file=@drawing.pdf<br />
            dpi=300 conf=0.25 imgsz=1280<br />
            include_base64=false
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-400">Returns five field objects with bbox, confidence, crop_url, OCR text if enabled, and optional base64 crop images for the next model.</p>
        </Card>
      </div>
    </div>
  )
}

function Metric({ icon: Icon, label, value, tone }) {
  return (
    <Card>
      <div className="flex items-center justify-between">
        <div><div className="text-sm text-slate-400">{label}</div><div className="mt-2 text-2xl font-black text-white">{value}</div></div>
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10"><Icon className="h-6 w-6 text-cyan-200" /></div>
      </div>
      <div className="mt-4"><Badge tone={tone}>live</Badge></div>
    </Card>
  )
}

function Step({ text }) {
  return <li className="flex items-start gap-3 rounded-2xl bg-slate-950/50 p-3"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" /><span>{text}</span></li>
}
