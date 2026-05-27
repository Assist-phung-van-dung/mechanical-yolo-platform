import { useEffect, useState } from 'react'
import { Boxes, Check, RefreshCcw, ShieldCheck } from 'lucide-react'
import { apiGet, apiPostForm } from '../api/client'
import { Badge, Button, Card, EmptyState, PageHeader } from '../components/UI'

export default function Models() {
  const [models, setModels] = useState([])
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function refresh() {
    const data = await apiGet('/api/models')
    setModels(data.models || [])
  }

  useEffect(() => {
    refresh().catch((err) => setError(err.message))
  }, [])

  async function activate(path) {
    setError('')
    setMessage('')
    const form = new FormData()
    form.append('model_path', path)
    try {
      const data = await apiPostForm('/api/models/activate', form)
      setMessage(`Activated: ${data.active_model_path}`)
      await refresh()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Model registry"
        title="Activate the best YOLO model"
        description="Keep model versions from training runs and choose which best.pt should be used by the PDF Demo and production API."
        action={<Button variant="ghost" onClick={() => refresh()}><RefreshCcw className="h-4 w-4" /> Refresh</Button>}
      />

      {error && <Card className="mb-5 border-rose-400/30 text-rose-200">{error}</Card>}
      {message && <Card className="mb-5 border-emerald-400/30 text-emerald-200">{message}</Card>}

      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-black text-white">Discovered models</h2>
          <Badge tone="blue">{models.length} files</Badge>
        </div>

        {models.length === 0 ? (
          <EmptyState title="No models found" description="Train from the Training page or copy best.pt to runtime/models/active/best.pt." />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {models.map((model) => (
              <div key={model.path} className="rounded-3xl border border-white/10 bg-slate-950/50 p-5">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="flex gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10">
                      <Boxes className="h-5 w-5 text-cyan-200" />
                    </div>
                    <div>
                      <div className="font-black text-white">{model.id}</div>
                      <div className="mt-1 break-all font-mono text-xs text-slate-400">{model.path}</div>
                    </div>
                  </div>
                  {model.is_active && <Badge tone="green">active</Badge>}
                </div>

                <div className="mb-4 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-2xl bg-white/5 p-3">
                    <div className="text-slate-400">Size</div>
                    <div className="font-black text-white">{model.size_mb} MB</div>
                  </div>
                  <div className="rounded-2xl bg-white/5 p-3">
                    <div className="text-slate-400">Modified</div>
                    <div className="font-black text-white">{formatTime(model.modified_at)}</div>
                  </div>
                </div>

                <Button disabled={model.is_active} variant={model.is_active ? 'ghost' : 'white'} onClick={() => activate(model.path)}>
                  {model.is_active ? <ShieldCheck className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                  {model.is_active ? 'Currently active' : 'Activate model'}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

function formatTime(ts) {
  if (!ts) return '-'
  return new Date(ts * 1000).toLocaleString()
}
