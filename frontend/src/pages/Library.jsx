import { useEffect, useMemo, useState } from 'react'
import { FilePlus2, FolderInput, Loader2, PlayCircle, RefreshCcw, Search, ShieldCheck, Sparkles } from 'lucide-react'
import { apiGet, apiPostForm, fieldNames } from '../api/client'
import { Badge, Button, Card, EmptyState, Input, PageHeader, Select, Textarea } from '../components/UI'

const defaultClassOrder = fieldNames.join('\n')

export default function Library() {
  const [stats, setStats] = useState(null)
  const [documents, setDocuments] = useState([])
  const [status, setStatus] = useState('')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [pdfFile, setPdfFile] = useState(null)
  const [pdfFolder, setPdfFolder] = useState('/data/imports/pdfs')
  const [cvatFolder, setCvatFolder] = useState('/data/imports/cvat-export')
  const [classOrder, setClassOrder] = useState(defaultClassOrder)
  const [markConfirmed, setMarkConfirmed] = useState(true)
  const [skipExisting, setSkipExisting] = useState(true)
  const [overwriteAnnotations, setOverwriteAnnotations] = useState(false)
  const [dpi, setDpi] = useState(300)
  const [prelabelOnImport, setPrelabelOnImport] = useState(true)
  const [prelabelMode, setPrelabelMode] = useState('unlabeled')
  const [prelabelLimit, setPrelabelLimit] = useState(200)
  const [prelabelConf, setPrelabelConf] = useState(0.15)
  const [prelabelImg, setPrelabelImg] = useState(1536)

  async function refresh() {
    const params = new URLSearchParams()
    if (status) params.set('status', status)
    if (query.trim()) params.set('q', query.trim())
    params.set('limit', '1000')
    const [statsData, docsData] = await Promise.all([
      apiGet('/api/library/stats'),
      apiGet(`/api/pdfs?${params.toString()}`),
    ])
    setStats(statsData)
    setDocuments(docsData.documents || [])
  }

  useEffect(() => {
    refresh().catch(() => {})
  }, [])

  async function runAction(action) {
    setLoading(true)
    setError('')
    setMessage('')
    try {
      const result = await action()
      setMessage(JSON.stringify(result, null, 2))
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function uploadPdf(e) {
    e.preventDefault()
    if (!pdfFile) return
    const form = new FormData()
    form.append('file', pdfFile)
    form.append('render', 'true')
    form.append('dpi', String(dpi))
    form.append('skip_existing', String(skipExisting))
    await runAction(() => apiPostForm('/api/pdfs/upload', form))
  }

  async function importPdfs(e) {
    e.preventDefault()
    const form = new FormData()
    form.append('folder', pdfFolder)
    form.append('render', 'true')
    form.append('dpi', String(dpi))
    form.append('recursive', 'true')
    form.append('skip_existing', String(skipExisting))
    form.append('prelabel', String(prelabelOnImport))
    form.append('conf', String(prelabelConf))
    form.append('imgsz', String(prelabelImg))
    form.append('prelabel_replace', 'false')
    await runAction(() => apiPostForm('/api/pdfs/import-folder', form))
  }

  async function importCvat(e) {
    e.preventDefault()
    const form = new FormData()
    form.append('folder', cvatFolder)
    form.append('class_order', classOrder)
    form.append('mark_confirmed', String(markConfirmed))
    form.append('skip_existing', String(skipExisting))
    form.append('overwrite_annotations', String(overwriteAnnotations))
    await runAction(() => apiPostForm('/api/cvat/import-folder', form))
  }

  async function prelabelBatch(e) {
    e.preventDefault()
    const form = new FormData()
    form.append('mode', prelabelMode)
    form.append('conf', String(prelabelConf))
    form.append('imgsz', String(prelabelImg))
    form.append('replace', 'false')
    form.append('limit', String(prelabelLimit))
    form.append('protect_human_labels', 'true')
    await runAction(() => apiPostForm('/api/label/prelabel-batch', form))
  }

  const statusCards = useMemo(() => ([
    ['Total docs', stats?.total_documents ?? 0, 'blue'],
    ['Rendered pages', stats?.rendered_pages ?? 0, 'green'],
    ['Confirmed pages', stats?.confirmed_pages ?? 0, 'green'],
    ['Need review', stats?.need_review_documents ?? 0, 'yellow'],
    ['Unlabeled', stats?.unlabeled_documents ?? 0, 'red'],
  ]), [stats])

  return (
    <div>
      <PageHeader
        eyebrow="Data control room"
        title="PDF Library & CVAT foundation"
        description="Bulk import PDFs, auto-render pages, optionally pre-label with YOLO, import the 5GB CVAT foundation without duplicates, and feed a clean review queue."
        action={<Button variant="ghost" onClick={() => refresh()}><RefreshCcw className="h-4 w-4" /> Refresh</Button>}
      />

      <div className="mb-5 grid gap-4 md:grid-cols-5">
        {statusCards.map(([label, value, tone]) => <StatCard key={label} label={label} value={value} tone={tone} />)}
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card>
          <div className="mb-4 flex items-center gap-3"><FilePlus2 className="h-5 w-5 text-cyan-300" /><h2 className="text-xl font-black text-white">Upload one PDF</h2></div>
          <form onSubmit={uploadPdf} className="space-y-4">
            <input className="block w-full rounded-2xl border border-white/10 bg-slate-950/60 p-3 text-sm text-slate-300" type="file" accept="application/pdf" onChange={(e) => setPdfFile(e.target.files?.[0] || null)} />
            <Input label="Render DPI" type="number" value={dpi} onChange={(e) => setDpi(Number(e.target.value))} />
            <CheckToggle label="Skip existing by hash" checked={skipExisting} onChange={setSkipExisting} />
            <Button disabled={loading || !pdfFile}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FilePlus2 className="h-4 w-4" />} Upload + render</Button>
          </form>
        </Card>

        <Card>
          <div className="mb-4 flex items-center gap-3"><FolderInput className="h-5 w-5 text-cyan-300" /><h2 className="text-xl font-black text-white">Bulk PDF folder</h2></div>
          <form onSubmit={importPdfs} className="space-y-4">
            <Input label="Server folder" value={pdfFolder} onChange={(e) => setPdfFolder(e.target.value)} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="DPI" type="number" value={dpi} onChange={(e) => setDpi(Number(e.target.value))} />
              <Input label="Prelabel imgsz" type="number" value={prelabelImg} onChange={(e) => setPrelabelImg(Number(e.target.value))} />
            </div>
            <Input label="Prelabel conf" type="number" step="0.01" value={prelabelConf} onChange={(e) => setPrelabelConf(Number(e.target.value))} />
            <CheckToggle label="Skip existing by hash" checked={skipExisting} onChange={setSkipExisting} />
            <CheckToggle label="Run YOLO pre-label after import" checked={prelabelOnImport} onChange={setPrelabelOnImport} />
            <Button disabled={loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderInput className="h-4 w-4" />} Import PDFs</Button>
          </form>
        </Card>

        <Card>
          <div className="mb-4 flex items-center gap-3"><ShieldCheck className="h-5 w-5 text-cyan-300" /><h2 className="text-xl font-black text-white">Import CVAT labels</h2></div>
          <form onSubmit={importCvat} className="space-y-4">
            <Input label="CVAT folder" value={cvatFolder} onChange={(e) => setCvatFolder(e.target.value)} />
            <Textarea label="CVAT class order" value={classOrder} onChange={(e) => setClassOrder(e.target.value)} />
            <CheckToggle label="Mark imported labels as confirmed" checked={markConfirmed} onChange={setMarkConfirmed} />
            <CheckToggle label="Skip existing images by hash" checked={skipExisting} onChange={setSkipExisting} />
            <CheckToggle label="Overwrite existing annotations" checked={overwriteAnnotations} onChange={setOverwriteAnnotations} />
            <Button disabled={loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Import CVAT labels</Button>
          </form>
        </Card>
      </div>

      <Card className="mt-5">
        <div className="grid gap-4 lg:grid-cols-[1fr,220px,220px,220px,auto] lg:items-end">
          <Select label="Batch pre-label queue" value={prelabelMode} onChange={(e) => setPrelabelMode(e.target.value)}>
            <option value="unlabeled">Unlabeled</option>
            <option value="missing_fields">Missing fields</option>
            <option value="need_review">Need review</option>
            <option value="low_confidence">Low confidence</option>
            <option value="random">Random</option>
          </Select>
          <Input label="Limit" type="number" value={prelabelLimit} onChange={(e) => setPrelabelLimit(Number(e.target.value))} />
          <Input label="Conf" type="number" step="0.01" value={prelabelConf} onChange={(e) => setPrelabelConf(Number(e.target.value))} />
          <Input label="Img size" type="number" value={prelabelImg} onChange={(e) => setPrelabelImg(Number(e.target.value))} />
          <Button onClick={prelabelBatch} disabled={loading}><Sparkles className="h-4 w-4" /> Pre-label batch</Button>
        </div>
        <p className="mt-3 text-xs text-slate-400">Batch pre-label protects human/CVAT confirmed boxes and only fills missing or YOLO-draft boxes.</p>
      </Card>

      {(error || message) && <Card className="mt-5"><pre className={`max-h-72 overflow-auto text-xs ${error ? 'text-rose-200' : 'text-emerald-100'}`}>{error || message}</pre></Card>}

      <Card className="mt-5">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-2xl font-black text-white">Documents</h2>
            <p className="text-sm text-slate-400">Open any row to review, correct, confirm, and auto-next through the queue.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Input placeholder="Search filename/pdf_id" value={query} onChange={(e) => setQuery(e.target.value)} />
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              <option value="new">New</option>
              <option value="unlabeled">Unlabeled</option>
              <option value="need_review">Need review</option>
              <option value="confirmed">Confirmed</option>
            </Select>
            <Button variant="ghost" onClick={() => refresh()}><Search className="h-4 w-4" /> Apply</Button>
          </div>
        </div>

        {documents.length === 0 ? (
          <EmptyState title="No documents found" description="Import PDFs or CVAT labels to populate the review library." />
        ) : (
          <div className="overflow-hidden rounded-2xl border border-white/10">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/5 text-slate-400">
                <tr>
                  <th className="p-3">Preview</th>
                  <th className="p-3">Document</th>
                  <th className="p-3">Pages</th>
                  <th className="p-3">Labels</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Open</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => (
                  <tr key={doc.pdf_id} className="border-t border-white/10">
                    <td className="p-3">{doc.first_page_url ? <img src={doc.first_page_url} className="h-14 w-20 rounded-xl object-cover" /> : <div className="h-14 w-20 rounded-xl bg-white/5" />}</td>
                    <td className="p-3"><div className="font-bold text-white">{doc.filename}</div><div className="font-mono text-xs text-slate-500">{doc.pdf_id}</div><div className="text-xs text-slate-400">{doc.source_type}</div></td>
                    <td className="p-3 text-slate-300">{doc.rendered_pages}/{doc.page_count}</td>
                    <td className="p-3 text-slate-300">{doc.confirmed_pages} confirmed · {doc.draft_pages} draft</td>
                    <td className="p-3"><Badge tone={statusTone(doc.status)}>{doc.status}</Badge></td>
                    <td className="p-3"><OpenLabelLink pdfId={doc.pdf_id} page={1} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {stats?.fields && <Card className="mt-5"><h2 className="mb-4 text-xl font-black text-white">Field coverage</h2><div className="grid gap-3 md:grid-cols-5">{fieldNames.map((name) => <FieldCoverage key={name} name={name} data={stats.fields[name]} />)}</div></Card>}
    </div>
  )
}

function CheckToggle({ label, checked, onChange }) {
  return (
    <label className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-slate-200">
      <span className="font-bold text-white">{label}</span>
      <input className="h-5 w-5 accent-blue-500" type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

function OpenLabelLink({ pdfId, page }) {
  return <a className="text-sm font-bold text-cyan-200 hover:text-cyan-100" href={`#label:${pdfId}:${page}`} onClick={(e) => { e.preventDefault(); window.dispatchEvent(new CustomEvent('open-label-page', { detail: { pdfId, page } })) }}>Open label</a>
}

function StatCard({ label, value, tone }) {
  return <Card className="p-4"><div className="mb-2"><Badge tone={tone}>{label}</Badge></div><div className="text-3xl font-black text-white">{value}</div></Card>
}

function FieldCoverage({ name, data }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
      <div className="break-all text-sm font-black text-white">{name}</div>
      <div className="mt-2 text-xs text-slate-400">Labeled</div>
      <div className="text-xl font-black text-emerald-200">{data?.labeled ?? 0}</div>
      <div className="mt-2 text-xs text-slate-400">Missing</div>
      <div className="text-xl font-black text-amber-200">{data?.missing ?? 0}</div>
    </div>
  )
}

function statusTone(status) {
  if (status === 'confirmed') return 'green'
  if (status === 'need_review') return 'yellow'
  if (status === 'unlabeled') return 'red'
  return 'blue'
}
