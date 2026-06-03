import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  FilePlus2,
  Loader2,
  Play,
  RefreshCcw,
  Shuffle,
  SquareArrowOutUpRight,
  XCircle,
} from 'lucide-react'
import { apiGet, apiPostForm, apiPostJson, fieldColors, fieldNames, formatFieldName } from '../api/client'
import { Badge, Button, Card, EmptyState, Input, PageHeader, Select, Textarea } from '../components/UI'

const decisionOptions = [
  ['unreviewed', 'Unreviewed'],
  ['correct', 'Correct'],
  ['wrong_box', 'Wrong box'],
  ['missing_should_exist', 'Missing but should exist'],
  ['not_present', 'Not present in drawing'],
]

const filterOptions = [
  ['all', 'All'],
  ['completed', 'Completed'],
  ['need_review', 'AI need review'],
  ['ai_good', 'AI good'],
  ['human_reviewed', 'Human reviewed'],
  ['final_fail', 'Final fail'],
  ['missing', 'Has missing fields'],
  ['failed', 'System failed'],
]

function pct(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-'
  return `${Math.round(Number(value) * 1000) / 10}%`
}

function number(value, digits = 2) {
  if (value === null || value === undefined || value === '') return '-'
  const n = Number(value)
  if (Number.isNaN(n)) return '-'
  return n.toFixed(digits)
}

export default function BatchEvaluation({ batchJobTarget }) {
  const [campaignName, setCampaignName] = useState('')
  const [sourceMode, setSourceMode] = useState('upload')
  const [files, setFiles] = useState([])
  const [dpi, setDpi] = useState(400)
  const [conf, setConf] = useState(0.15)
  const [imgsz, setImgsz] = useState(1536)
  const [limit, setLimit] = useState(100)
  const [runOcr, setRunOcr] = useState(false)
  const [ocrEngine, setOcrEngine] = useState('auto+qwen')
  const [randomSeed, setRandomSeed] = useState('')
  const [job, setJob] = useState(null)
  const [items, setItems] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const pollRef = useRef(null)

  const selected = useMemo(() => items.find((item) => item.item_id === selectedId) || items[0] || null, [items, selectedId])
  const visibleItems = useMemo(() => filterItems(items, filter), [items, filter])
  const summary = job?.summary || {}

  useEffect(() => {
    if (batchJobTarget?.jobId) {
      loadJob(batchJobTarget.jobId)
    }
  }, [batchJobTarget?.jobId])

  useEffect(() => {
    function openBatch(event) {
      if (event.detail?.jobId) loadJob(event.detail.jobId)
    }
    window.addEventListener('open-batch-job', openBatch)
    return () => window.removeEventListener('open-batch-job', openBatch)
  }, [])

  useEffect(() => {
    if (!job?.job_id) return
    if (job.status === 'completed' || job.status === 'failed') return

    pollRef.current = window.setInterval(() => {
      refreshJob(job.job_id).catch(() => {})
    }, 1500)

    return () => window.clearInterval(pollRef.current)
  }, [job?.job_id, job?.status])

  async function loadJob(jobId) {
    setError('')
    setMessage(`Loaded saved batch ${jobId}.`)
    await refreshJob(jobId)
  }

  async function refreshJob(jobId = job?.job_id) {
    if (!jobId) return
    const data = await apiGet(`/api/batch-eval/${jobId}?include_items=true`)
    setJob(data)
    setItems(data.items || [])
    if (!selectedId && data.items?.length) setSelectedId(data.items[0].item_id)
  }

  function findNextUnreviewedItemId(list, currentItemId) {
    const visible = filterItems(list || [], filter).filter((item) => item.status === 'completed')
    if (visible.length === 0) return ''

    const startIndex = Math.max(0, visible.findIndex((item) => item.item_id === currentItemId))
    const ordered = [
      ...visible.slice(startIndex + 1),
      ...visible.slice(0, startIndex + 1),
    ]

    const next = ordered.find((item) => !item.human_review?.reviewed && item.item_id !== currentItemId)
    if (next) return next.item_id

    const fallback = (list || []).find((item) => item.status === 'completed' && !item.human_review?.reviewed && item.item_id !== currentItemId)
    return fallback?.item_id || ''
  }

  async function startJob(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setMessage('')
    setItems([])
    setSelectedId('')

    const form = new FormData()
    form.append('campaign_name', campaignName)
    form.append('source_mode', sourceMode)
    form.append('dpi', String(dpi))
    form.append('conf', String(conf))
    form.append('imgsz', String(imgsz))
    form.append('limit', String(limit))
    form.append('run_ocr', String(runOcr))
    form.append('ocr_engine', ocrEngine)
    if (randomSeed !== '') form.append('random_seed', String(randomSeed))

    if (sourceMode === 'upload') {
      Array.from(files).slice(0, limit).forEach((file) => form.append('files', file))
    }

    try {
      const data = await apiPostForm('/api/batch-eval/start', form)
      setJob(data)
      setItems([])
      setMessage(`Started ${data.job_id}. Results will appear as each PDF finishes.`)
      await refreshJob(data.job_id)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function saveReview(item, patch) {
    if (!job?.job_id || !item?.item_id) return
    setError('')
    try {
      const updated = await apiPostJson(`/api/batch-eval/${job.job_id}/items/${item.item_id}/review`, patch)

      let nextId = ''
      let nextName = ''

      setItems((prev) => {
        const updatedList = prev.map((x) => (x.item_id === updated.item_id ? updated : x))
        nextId = findNextUnreviewedItemId(updatedList, updated.item_id)
        nextName = updatedList.find((x) => x.item_id === nextId)?.pdf_name || ''
        return updatedList
      })

      if (nextId) {
        setSelectedId(nextId)
        setMessage(`Human review saved. Moved to next unreviewed PDF: ${nextName || nextId}.`)
      } else {
        setSelectedId(updated.item_id)
        setMessage('Human review saved. No more unreviewed completed PDFs in this batch.')
      }

      await refreshJob(job.job_id)
    } catch (err) {
      setError(err.message)
    }
  }

  function markAllCorrect(item) {
    const fields = {}
    for (const name of fieldNames) {
      const detected = item?.result?.fields?.[name]?.detected
      fields[name] = { decision: detected ? 'correct' : 'not_present', note: detected ? '' : 'No field visible in this drawing' }
    }
    saveReview(item, { fields })
  }

  async function sendToLabelWorkspace(item) {
    if (!job?.job_id || !item?.item_id) return
    setError('')
    try {
      const form = new FormData()
      form.append('dpi', String(dpi))
      const promoted = await apiPostForm(`/api/batch-eval/${job.job_id}/items/${item.item_id}/send-to-label`, form)
      const target = promoted.label_target || {}
      window.dispatchEvent(new CustomEvent('open-label-page', {
        detail: {
          pdfId: target.pdfId,
          page: target.page || 1,
          item,
        },
      }))
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Batch evaluation center"
        title="Bulk PDF model evaluation"
        description="Upload many PDFs, or randomly sample from /data/imports/pdfs. Jobs run asynchronously; each completed PDF appears immediately. The viewer now puts the drawing on top and the five fields below for easier visual comparison."
      />

      <Card className="mb-5">
        <form onSubmit={startJob} className="grid gap-4 2xl:grid-cols-[1.2fr,1fr]">
          <div className="space-y-4">
            <Input
              label="Campaign name"
              value={campaignName}
              onChange={(e) => setCampaignName(e.target.value)}
              placeholder="Example: New layout test - May 2026"
            />
            <div className="grid gap-3 md:grid-cols-2">
              <Select label="Source" value={sourceMode} onChange={(e) => setSourceMode(e.target.value)}>
                <option value="upload">Upload PDFs</option>
                <option value="random_imports">Random from /data/imports/pdfs</option>
              </Select>
              <Input label="Limit PDFs" type="number" min="1" value={limit} onChange={(e) => setLimit(Number(e.target.value))} />
            </div>

            {sourceMode === 'upload' ? (
              <div className="rounded-3xl border border-dashed border-cyan-300/30 bg-cyan-300/5 p-5">
                <label className="flex cursor-pointer flex-col items-center justify-center text-center">
                  <FilePlus2 className="mb-3 h-10 w-10 text-cyan-200" />
                  <span className="text-sm font-black text-white">Choose many PDF files</span>
                  <span className="mt-1 text-xs text-slate-400">The first {limit || 0} files will be processed.</span>
                  <input
                    className="mt-4 block w-full rounded-2xl border border-white/10 bg-slate-950/70 p-3 text-sm text-slate-300 file:mr-4 file:rounded-xl file:border-0 file:bg-white file:px-3 file:py-2 file:text-sm file:font-bold file:text-slate-950"
                    type="file"
                    accept="application/pdf,.pdf"
                    multiple
                    onChange={(e) => setFiles(e.target.files || [])}
                  />
                </label>
                <div className="mt-3 text-xs text-slate-400">Selected: {files?.length || 0} PDF(s)</div>
              </div>
            ) : (
              <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
                <div className="flex items-start gap-3">
                  <Shuffle className="mt-1 h-5 w-5 text-cyan-200" />
                  <div>
                    <div className="font-bold text-white">Random sampling from imports</div>
                    <p className="mt-1 text-sm leading-6 text-slate-400">
                      Backend will randomly pick PDFs from <code className="rounded bg-slate-950/60 px-2 py-1 text-cyan-200">/data/imports/pdfs</code> up to the selected limit.
                    </p>
                  </div>
                </div>
                <div className="mt-4 max-w-xs">
                  <Input label="Random seed optional" value={randomSeed} onChange={(e) => setRandomSeed(e.target.value)} placeholder="blank = random" />
                </div>
              </div>
            )}
          </div>

          <div className="space-y-4 rounded-3xl border border-white/10 bg-white/[0.03] p-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Input label="DPI" type="number" value={dpi} onChange={(e) => setDpi(Number(e.target.value))} />
              <Input label="Conf" type="number" min="0" max="1" step="0.01" value={conf} onChange={(e) => setConf(Number(e.target.value))} />
              <Input label="Img size" type="number" value={imgsz} onChange={(e) => setImgsz(Number(e.target.value))} />
              <Input label="OCR engine" value={ocrEngine} onChange={(e) => setOcrEngine(e.target.value)} />
            </div>
            <label className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-950/50 p-4 text-sm text-slate-200">
              <span>
                <span className="font-bold text-white">Run OCR/Qwen</span>
                <span className="block text-xs text-slate-400">Off by default. Turn on only when you want text values during evaluation.</span>
              </span>
              <input className="h-5 w-5 accent-blue-500" type="checkbox" checked={runOcr} onChange={(e) => setRunOcr(e.target.checked)} />
            </label>
            <Button disabled={loading || (sourceMode === 'upload' && (!files || files.length === 0))} type="submit" className="w-full">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Start async evaluation
            </Button>
          </div>
        </form>
      </Card>

      {error && <div className="mb-4 rounded-2xl border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-100">{error}</div>}
      {message && <div className="mb-4 rounded-2xl border border-cyan-400/30 bg-cyan-400/10 p-4 text-sm text-cyan-100">{message}</div>}

      {job ? (
        <div className="space-y-5">
          <SummaryPanel job={job} summary={summary} onRefresh={() => refreshJob(job.job_id)} />

          <div className="grid gap-5 xl:grid-cols-[390px,minmax(0,1fr)]">
            <Card className="max-h-[82vh] overflow-auto">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-black text-white">PDF results</div>
                  <div className="text-xs text-slate-400">{visibleItems.length} visible / {items.length} total</div>
                </div>
                <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="min-w-44">
                  {filterOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </Select>
              </div>

              <div className="space-y-2">
                {visibleItems.length === 0 ? (
                  <EmptyState title="No completed results yet" description="The list updates automatically while the async job is running." />
                ) : visibleItems.map((item) => (
                  <button
                    key={item.item_id}
                    onClick={() => setSelectedId(item.item_id)}
                    className={`w-full rounded-2xl border p-3 text-left transition ${selected?.item_id === item.item_id ? 'border-cyan-300 bg-cyan-300/10' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.07]'}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-bold text-white">#{item.index} {item.pdf_name}</div>
                        <div className="mt-1 text-xs text-slate-400">{item.item_id}</div>
                      </div>
                      <StatusBadge item={item} />
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                      <MiniMetric label="Detected" value={`${countDetected(item)}/5`} />
                      <MiniMetric label="AI score" value={pct(item.ai_evaluation?.quality_score)} />
                      <MiniMetric label="Final" value={item.final_evaluation?.status || item.status} />
                    </div>
                  </button>
                ))}
              </div>
            </Card>

            <ResultViewer item={selected} job={job} onSaveReview={saveReview} onMarkAllCorrect={markAllCorrect} onSendToLabel={sendToLabelWorkspace} />
          </div>
        </div>
      ) : (
        <Card>
          <EmptyState title="No batch job yet" description="Start with uploaded PDFs or random samples from /data/imports/pdfs. Results appear one-by-one as soon as each PDF finishes." />
        </Card>
      )}
    </div>
  )
}

function SummaryPanel({ job, summary, onRefresh }) {
  const exportUrl = job?.job_id ? `/api/batch-eval/${job.job_id}/export.csv` : '#'
  return (
    <Card>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-sm text-slate-400">Job</div>
          <div className="text-xl font-black text-white">{job.campaign_name || job.job_id}</div>
          <div className="mt-1 font-mono text-xs text-slate-500">{job.job_id}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={job.status === 'completed' ? 'green' : 'blue'}>{job.status}</Badge>
          <Button variant="ghost" onClick={onRefresh}><RefreshCcw className="h-4 w-4" /> Refresh</Button>
          <a href={exportUrl} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-white hover:bg-white/10">
            <Download className="h-4 w-4" /> Export CSV
          </a>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <BigMetric label="Processed" value={`${job.processed || summary.completed || 0}/${job.total || summary.total || 0}`} />
        <BigMetric label="AI detected rate" value={pct(summary.detection_rate)} />
        <BigMetric label="Avg YOLO conf" value={number(summary.avg_confidence, 3)} />
        <BigMetric label="AI need review" value={summary.ai_need_review ?? 0} />
        <BigMetric label="Human accepted" value={summary.human_accepted_rate === null || summary.human_accepted_rate === undefined ? '-' : pct(summary.human_accepted_rate)} />
        <BigMetric label="Final pass rate" value={pct(summary.final_pass_rate)} />
      </div>
      <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/40 p-4 text-sm text-slate-300">
        Final result uses human review when available. Otherwise it uses the AI estimate. A field marked <b>Not present in drawing</b> is not counted as a YOLO mistake by human review.
      </div>
    </Card>
  )
}

function ResultViewer({ item, job, onSaveReview, onMarkAllCorrect, onSendToLabel }) {
  const [localReview, setLocalReview] = useState({})
  const [note, setNote] = useState('')

  useEffect(() => {
    const fields = item?.human_review?.fields || {}
    const next = {}
    for (const name of fieldNames) next[name] = fields[name]?.decision || 'unreviewed'
    setLocalReview(next)
    setNote(item?.human_review?.note || '')
  }, [item?.item_id])

  if (!item) {
    return <Card><EmptyState title="Select a PDF result" description="Completed PDFs will appear in the result list. Click one to inspect the drawing, crops, AI score, and human review." /></Card>
  }

  if (item.status === 'queued' || item.status === 'running') {
    return (
      <Card>
        <div className="flex items-center gap-3 text-cyan-100"><Loader2 className="h-5 w-5 animate-spin" /> {item.pdf_name} is {item.status}...</div>
      </Card>
    )
  }

  if (item.status === 'failed') {
    return (
      <Card>
        <div className="flex items-center gap-3 text-rose-200"><XCircle className="h-5 w-5" /> Failed: {item.error}</div>
      </Card>
    )
  }

  const result = item.result || {}
  const page = result.pages?.[0]
  const fields = result.fields || {}

  function updateDecision(field, decision) {
    setLocalReview((prev) => ({ ...prev, [field]: decision }))
  }

  function save() {
    const payload = { fields: {}, note }
    for (const name of fieldNames) payload.fields[name] = { decision: localReview[name] || 'unreviewed', note: '' }
    onSaveReview(item, payload)
  }

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-sm text-slate-400">Selected PDF</div>
            <div className="text-2xl font-black text-white">{item.pdf_name}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge tone={item.ai_evaluation?.status === 'good' ? 'green' : 'yellow'}>AI: {item.ai_evaluation?.status || '-'}</Badge>
              <Badge tone={item.final_evaluation?.source === 'human' ? 'blue' : 'slate'}>Final: {item.final_evaluation?.status || '-'}</Badge>
              {result.warning && <Badge tone="yellow">warning</Badge>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => onMarkAllCorrect(item)}><CheckCircle2 className="h-4 w-4" /> Mark detected correct</Button>
            <Button variant="ghost" onClick={() => onSendToLabel(item)}><SquareArrowOutUpRight className="h-4 w-4" /> Send to Label Workspace</Button>
            <Button onClick={save}>Save human review</Button>
          </div>
        </div>
        {result.warning && <div className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">{result.warning}</div>}
      </Card>

      <Card className="overflow-hidden p-3">
        <div className="mb-3 flex items-center justify-between px-2">
          <div className="font-bold text-white">Drawing preview</div>
          <div className="text-xs text-slate-400">Large PDF preview first. Boxes only; labels are hidden to avoid covering the drawing.</div>
        </div>
        {page ? <DrawingPreview page={page} fields={fields} /> : <EmptyState title="No rendered page" description="This item has no page preview." />}
      </Card>

      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-5">
        {fieldNames.map((name) => (
          <FieldReviewCard
            key={name}
            name={name}
            field={fields[name]}
            aiStatus={item.ai_evaluation?.field_status?.[name]}
            decision={localReview[name] || 'unreviewed'}
            onDecision={(decision) => updateDecision(name, decision)}
          />
        ))}
      </div>

      <Card>
        <Textarea label="Human review note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional reason, e.g. new title-block layout or field not present on this drawing." />
        <Button className="mt-3 w-full" onClick={save}>Save human review</Button>
      </Card>
    </div>
  )
}

function DrawingPreview({ page, fields }) {
  const imageUrl = page.image_url
  return (
    <div className="relative max-h-[72vh] overflow-auto rounded-2xl bg-slate-950/80">
      <div className="relative mx-auto" style={{ width: '100%', maxWidth: 1800 }}>
        <img src={imageUrl} alt="rendered pdf page" className="block w-full select-none" />
        {fieldNames.map((name) => {
          const item = fields?.[name]
          if (!item?.detected || !item.bbox || !page.width || !page.height) return null
          const [x1, y1, x2, y2] = item.bbox
          const style = {
            left: `${(x1 / page.width) * 100}%`,
            top: `${(y1 / page.height) * 100}%`,
            width: `${((x2 - x1) / page.width) * 100}%`,
            height: `${((y2 - y1) / page.height) * 100}%`,
            borderColor: fieldColors[name] || '#38bdf8',
            boxShadow: `0 0 0 1px ${fieldColors[name] || '#38bdf8'}, 0 0 18px ${fieldColors[name] || '#38bdf8'}55`,
          }
          return <div key={name} className="absolute border-2 bg-transparent" style={style} title={`${formatFieldName(name)} ${item.confidence || ''}`} />
        })}
      </div>
    </div>
  )
}

function FieldReviewCard({ name, field, aiStatus, decision, onDecision }) {
  const detected = field?.detected
  const tone = !detected ? 'yellow' : aiStatus?.status === 'detected_good' ? 'green' : 'yellow'
  return (
    <Card className="flex h-full flex-col p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="h-4 w-4 rounded-full" style={{ backgroundColor: fieldColors[name] }} />
          <div>
            <div className="font-black text-white">{formatFieldName(name)}</div>
            <div className="text-xs text-slate-400">{detected ? `conf ${number(field.confidence, 3)}` : 'missing crop'}</div>
          </div>
        </div>
        <Badge tone={tone}>{aiStatus?.status || (detected ? 'detected' : 'missing')}</Badge>
      </div>

      <div className="mb-3 flex min-h-28 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-slate-950/70">
        {field?.crop_url ? (
          <img src={field.crop_url} alt={name} className="max-h-40 w-full object-contain" />
        ) : (
          <div className="text-center text-xs text-slate-500">No crop</div>
        )}
      </div>

      <div className="mb-3 space-y-1 text-xs text-slate-400">
        <div>Value: <span className="text-slate-200">{field?.value || field?.predicted_text || '-'}</span></div>
        <div>BBox: <span className="font-mono text-slate-300">{field?.bbox ? JSON.stringify(field.bbox) : '-'}</span></div>
      </div>

      <div className="mt-auto grid grid-cols-1 gap-2">
        {decisionOptions.map(([value, label]) => (
          <button
            key={value}
            onClick={() => onDecision(value)}
            className={`rounded-xl border px-3 py-2 text-left text-xs font-bold transition ${decision === value ? 'border-cyan-300 bg-cyan-300/15 text-cyan-100' : 'border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.08]'}`}
          >
            {label}
          </button>
        ))}
      </div>
    </Card>
  )
}

function StatusBadge({ item }) {
  const final = item.final_evaluation?.status
  if (item.status === 'failed') return <Badge tone="red">failed</Badge>
  if (item.status === 'running') return <Badge tone="blue">running</Badge>
  if (final === 'pass' || final === 'pass_estimate') return <Badge tone="green">{final}</Badge>
  if (final === 'fail') return <Badge tone="red">fail</Badge>
  return <Badge tone="yellow">review</Badge>
}

function BigMetric({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
      <div className="text-xs font-bold uppercase tracking-widest text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-black text-white">{value}</div>
    </div>
  )
}

function MiniMetric({ label, value }) {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/50 p-2">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 truncate font-bold text-white">{value}</div>
    </div>
  )
}

function countDetected(item) {
  const fields = item?.result?.fields || {}
  return fieldNames.filter((name) => fields[name]?.detected).length
}

function filterItems(items, filter) {
  if (filter === 'all') return items
  return items.filter((item) => {
    if (filter === 'completed') return item.status === 'completed'
    if (filter === 'failed') return item.status === 'failed'
    if (filter === 'need_review') return item.ai_evaluation?.status === 'need_review'
    if (filter === 'ai_good') return item.ai_evaluation?.status === 'good'
    if (filter === 'human_reviewed') return item.human_review?.reviewed
    if (filter === 'final_fail') return item.final_evaluation?.status === 'fail'
    if (filter === 'missing') return (item.ai_evaluation?.missing_fields || []).length > 0
    return true
  })
}
