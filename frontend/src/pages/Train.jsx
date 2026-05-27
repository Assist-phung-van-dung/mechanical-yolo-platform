import { useEffect, useMemo, useState } from 'react'
import { BrainCircuit, Loader2, Play, RefreshCcw, TerminalSquare } from 'lucide-react'
import { apiGet, apiPostForm } from '../api/client'
import { Badge, Button, Card, EmptyState, Input, PageHeader, Select } from '../components/UI'

export default function Train() {
  const [datasets, setDatasets] = useState([])
  const [jobs, setJobs] = useState([])
  const [selectedJob, setSelectedJob] = useState(null)
  const [datasetId, setDatasetId] = useState('')
  const [baseModel, setBaseModel] = useState('yolo11n.pt')
  const [epochs, setEpochs] = useState(100)
  const [imgsz, setImgsz] = useState(1280)
  const [batch, setBatch] = useState(8)
  const [device, setDevice] = useState('0')
  const [patience, setPatience] = useState(30)
  const [workers, setWorkers] = useState(4)
  const [cache, setCache] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function refresh() {
    const [ds, js] = await Promise.all([apiGet('/api/datasets'), apiGet('/api/train/jobs')])
    setDatasets(ds.datasets || [])
    setJobs(js.jobs || [])
    if (!datasetId && ds.datasets?.[0]) setDatasetId(ds.datasets[0].dataset_id)
  }

  useEffect(() => {
    refresh().catch(() => {})
    const timer = setInterval(() => refresh().catch(() => {}), 5000)
    return () => clearInterval(timer)
  }, [])

  async function start(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const form = new FormData()
    form.append('dataset_id', datasetId)
    form.append('base_model', baseModel)
    form.append('epochs', epochs)
    form.append('imgsz', imgsz)
    form.append('batch', batch)
    if (device.trim()) form.append('device', device.trim())
    form.append('patience', patience)
    form.append('workers', workers)
    form.append('cache', String(cache))
    try {
      const job = await apiPostForm('/api/train/start', form)
      setSelectedJob(job)
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function openJob(jobId) {
    const job = await apiGet(`/api/train/jobs/${jobId}`)
    setSelectedJob(job)
  }

  const latestRunning = useMemo(() => jobs.find((j) => j.status === 'running' || j.status === 'queued'), [jobs])

  return (
    <div>
      <PageHeader
        eyebrow="Model training"
        title="Train YOLO on reviewed field data"
        description="Train from CVAT data or the cleaner confirmed-label dataset. Use patience for early stopping and workers/cache settings to avoid Docker shared-memory issues."
        action={<Button variant="ghost" onClick={() => refresh()}><RefreshCcw className="h-4 w-4" /> Refresh</Button>}
      />

      <div className="grid gap-5 xl:grid-cols-[420px,1fr]">
        <Card>
          <form onSubmit={start} className="space-y-4">
            <div className="flex items-center gap-3 rounded-3xl border border-white/10 bg-white/5 p-4">
              <BrainCircuit className="h-9 w-9 text-cyan-200" />
              <div>
                <div className="font-black text-white">Training parameters</div>
                <div className="text-sm text-slate-400">Good default for mechanical drawings.</div>
              </div>
            </div>

            <Select label="Dataset" value={datasetId} onChange={(e) => setDatasetId(e.target.value)}>
              <option value="">Select dataset</option>
              {datasets.map((ds) => <option key={ds.dataset_id} value={ds.dataset_id}>{ds.dataset_id}</option>)}
            </Select>

            <Input label="Base model" value={baseModel} onChange={(e) => setBaseModel(e.target.value)} />
            <div className="grid grid-cols-3 gap-3">
              <Input label="Epochs" type="number" value={epochs} onChange={(e) => setEpochs(Number(e.target.value))} />
              <Input label="Img size" type="number" value={imgsz} onChange={(e) => setImgsz(Number(e.target.value))} />
              <Input label="Batch" type="number" value={batch} onChange={(e) => setBatch(Number(e.target.value))} />
            </div>
            <Input label="Device" placeholder="0, 1, 0,1 or cpu" value={device} onChange={(e) => setDevice(e.target.value)} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Patience" type="number" value={patience} onChange={(e) => setPatience(Number(e.target.value))} />
              <Input label="Workers" type="number" value={workers} onChange={(e) => setWorkers(Number(e.target.value))} />
            </div>
            <label className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-200">
              <span><span className="font-bold text-white">Cache images</span><span className="block text-xs text-slate-400">Keep off for large datasets unless RAM is abundant.</span></span>
              <input className="h-5 w-5 accent-blue-500" type="checkbox" checked={cache} onChange={(e) => setCache(e.target.checked)} />
            </label>

            <Button disabled={!datasetId || loading} className="w-full" type="submit">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {loading ? 'Starting...' : 'Start training'}
            </Button>
          </form>

          {error && <div className="mt-4 rounded-2xl border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-200">{error}</div>}
          {latestRunning && <div className="mt-4 rounded-2xl border border-cyan-400/30 bg-cyan-400/10 p-4 text-sm text-cyan-100">Job {latestRunning.job_id} is {latestRunning.status}.</div>}
        </Card>

        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-black text-white">Training jobs</h2>
            <Badge tone="blue">{jobs.length} jobs</Badge>
          </div>

          {jobs.length === 0 ? (
            <EmptyState title="No training jobs" description="Import a dataset, then start training to create field-detector model versions." />
          ) : (
            <div className="space-y-3">
              {jobs.map((job) => (
                <button key={job.job_id} onClick={() => openJob(job.job_id)} className="w-full rounded-3xl border border-white/10 bg-slate-950/50 p-4 text-left transition hover:bg-white/10">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="font-mono text-sm font-black text-white">{job.job_id}</div>
                      <div className="mt-1 text-xs text-slate-400">{job.dataset_id} | {job.base_model} | imgsz {job.imgsz} | epochs {job.epochs} | patience {job.patience ?? '-'}</div>
                    </div>
                    <Badge tone={statusTone(job.status)}>{job.status}</Badge>
                  </div>
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>

      {selectedJob && (
        <Card className="mt-5">
          <div className="mb-4 flex items-center gap-3">
            <TerminalSquare className="h-6 w-6 text-cyan-200" />
            <div>
              <h2 className="text-xl font-black text-white">Job log: {selectedJob.job_id}</h2>
              <div className="text-sm text-slate-400">Status: {selectedJob.status}</div>
            </div>
          </div>
          {selectedJob.model_path && <div className="mb-4 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-sm text-emerald-100">Best model: {selectedJob.model_path}</div>}
          <pre className="max-h-[520px] overflow-auto rounded-2xl bg-slate-950 p-4 text-xs leading-5 text-slate-300">{selectedJob.log_tail || 'Log will appear after the worker starts.'}</pre>
        </Card>
      )}
    </div>
  )
}

function statusTone(status) {
  if (status === 'completed') return 'green'
  if (status === 'failed') return 'red'
  if (status === 'running') return 'blue'
  return 'yellow'
}
