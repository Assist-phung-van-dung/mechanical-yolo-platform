import { useEffect, useMemo, useState } from 'react'
import { Clock3, Download, Eye, RefreshCcw, Search, Trash2 } from 'lucide-react'
import { apiDelete, apiGet } from '../api/client'
import { Badge, Button, Card, EmptyState, Input, PageHeader } from '../components/UI'

function pct(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-'
  return `${Math.round(Number(value) * 1000) / 10}%`
}

function dateTime(value) {
  if (!value) return '-'
  try {
    return new Date(Number(value) * 1000).toLocaleString()
  } catch {
    return '-'
  }
}

export default function BatchHistory() {
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return jobs
    return jobs.filter((job) => `${job.campaign_name || ''} ${job.job_id} ${job.status} ${job.source_mode}`.toLowerCase().includes(term))
  }, [jobs, q])

  useEffect(() => {
    loadJobs()
  }, [])

  async function loadJobs() {
    setLoading(true)
    setError('')
    try {
      const data = await apiGet('/api/batch-eval/jobs?limit=300')
      setJobs(data.jobs || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function openJob(job) {
    window.dispatchEvent(new CustomEvent('open-batch-job', { detail: { jobId: job.job_id } }))
  }

  async function deleteJob(job) {
    const label = job.campaign_name || job.job_id
    if (!window.confirm(`Delete campaign "${label}"? This removes its saved batch results from runtime/batch_eval/jobs.`)) return
    setLoading(true)
    setError('')
    try {
      await apiDelete(`/api/batch-eval/${job.job_id}`)
      setJobs((prev) => prev.filter((item) => item.job_id !== job.job_id))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Batch history"
        title="Saved batch evaluation jobs"
        description="Review previous batch runs, reopen old results, continue human evaluation, and export CSV reports. All jobs are stored under runtime/batch_eval/jobs."
        action={<Button variant="ghost" onClick={loadJobs}><RefreshCcw className="h-4 w-4" /> Refresh</Button>}
      />

      {error && <div className="mb-4 rounded-2xl border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-100">{error}</div>}

      <Card className="mb-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3 text-slate-300">
            <Clock3 className="h-5 w-5 text-cyan-200" />
            <span>{jobs.length} saved batch job(s)</span>
          </div>
          <div className="relative w-full lg:max-w-md">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <Input className="pl-10" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search job id/status/source" />
          </div>
        </div>
      </Card>

      {loading ? (
        <Card><div className="text-slate-300">Loading batch history...</div></Card>
      ) : filtered.length === 0 ? (
        <Card><EmptyState title="No batch jobs found" description="Run a Batch Evaluation first. Completed and in-progress jobs will be saved here automatically." /></Card>
      ) : (
        <div className="grid gap-4">
          {filtered.map((job) => <JobCard key={job.job_id} job={job} onOpen={() => openJob(job)} onDelete={() => deleteJob(job)} />)}
        </div>
      )}
    </div>
  )
}

function JobCard({ job, onOpen, onDelete }) {
  const summary = job.summary || {}
  const options = job.options || {}
  const exportUrl = `/api/batch-eval/${job.job_id}/export.csv`
  const tone = job.status === 'completed' ? 'green' : job.status === 'failed' ? 'red' : 'blue'

  return (
    <Card>
      <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-center 2xl:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge tone={tone}>{job.status || 'unknown'}</Badge>
            <Badge tone="slate">{job.source_mode || 'source'}</Badge>
            <span className="text-xs text-slate-500">Created: {dateTime(job.created_at)}</span>
          </div>
          <div className="break-words text-lg font-black text-white">{job.campaign_name || job.job_id}</div>
          <div className="mt-1 break-all font-mono text-xs text-slate-500">{job.job_id}</div>
          <div className="mt-2 text-sm text-slate-400">
            DPI {options.dpi ?? '-'} · Conf {options.conf ?? '-'} · Img {options.imgsz ?? '-'} · OCR {options.run_ocr ? 'on' : 'off'} · Limit {options.limit ?? '-'}
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-6 2xl:min-w-[760px]">
          <Mini label="Processed" value={`${job.processed || summary.completed || 0}/${job.total || summary.total || 0}`} />
          <Mini label="AI detected" value={pct(summary.detection_rate)} />
          <Mini label="Need review" value={summary.ai_need_review ?? 0} />
          <Mini label="Human reviewed" value={summary.human_reviewed ?? 0} />
          <Mini label="Accepted" value={summary.human_accepted_rate === null || summary.human_accepted_rate === undefined ? '-' : pct(summary.human_accepted_rate)} />
          <Mini label="Final pass" value={pct(summary.final_pass_rate)} />
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <Button onClick={onOpen}><Eye className="h-4 w-4" /> Open results</Button>
          <Button variant="danger" onClick={onDelete}><Trash2 className="h-4 w-4" /> Delete</Button>
          <a href={exportUrl} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-white hover:bg-white/10">
            <Download className="h-4 w-4" /> CSV
          </a>
        </div>
      </div>
    </Card>
  )
}

function Mini({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-3">
      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-black text-white">{value}</div>
    </div>
  )
}
