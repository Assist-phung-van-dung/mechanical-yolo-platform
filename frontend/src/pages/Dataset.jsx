import { useEffect, useState } from 'react'
import { Archive, DatabaseZap, Hammer, Loader2, RefreshCcw, UploadCloud } from 'lucide-react'
import { apiGet, apiPostForm } from '../api/client'
import { Badge, Button, Card, EmptyState, Input, PageHeader } from '../components/UI'

export default function Dataset() {
  const [file, setFile] = useState(null)
  const [datasetName, setDatasetName] = useState('mechanical-fields')
  const [confirmedDatasetName, setConfirmedDatasetName] = useState('mechanical-confirmed-v1')
  const [valRatio, setValRatio] = useState(0.2)
  const [requireAllFields, setRequireAllFields] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [datasets, setDatasets] = useState([])

  async function loadDatasets() {
    const data = await apiGet('/api/datasets')
    setDatasets(data.datasets || [])
  }

  useEffect(() => {
    loadDatasets().catch(() => {})
  }, [])

  async function submitZip(e) {
    e.preventDefault()
    if (!file) return
    setLoading(true)
    setError('')
    setResult(null)
    const form = new FormData()
    form.append('file', file)
    form.append('dataset_name', datasetName)
    form.append('val_ratio', valRatio)
    try {
      const data = await apiPostForm('/api/dataset/upload-cvat', form)
      setResult(data)
      await loadDatasets()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function buildConfirmed(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setResult(null)
    const form = new FormData()
    form.append('dataset_id', confirmedDatasetName)
    form.append('val_ratio', String(valRatio))
    form.append('seed', '42')
    form.append('require_all_fields', String(requireAllFields))
    try {
      const data = await apiPostForm('/api/dataset/build-from-confirmed', form)
      setResult(data)
      await loadDatasets()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Dataset builder"
        title="Build clean YOLO datasets"
        description="Use your CVAT export directly, or build a stronger dataset from annotation JSON that has been reviewed and confirmed in the Label Workspace."
        action={<Button variant="ghost" onClick={() => loadDatasets()}><RefreshCcw className="h-4 w-4" /> Refresh</Button>}
      />

      <div className="grid gap-5 xl:grid-cols-[420px,420px,1fr]">
        <Card>
          <form onSubmit={submitZip} className="space-y-4">
            <div className="rounded-3xl border border-dashed border-blue-300/30 bg-blue-300/5 p-5 text-center">
              <Archive className="mx-auto mb-3 h-10 w-10 text-blue-200" />
              <label className="block cursor-pointer">
                <span className="text-sm font-bold text-white">Upload CVAT export zip</span>
                <input className="mt-4 block w-full rounded-2xl border border-white/10 bg-slate-950/70 p-3 text-sm text-slate-300 file:mr-4 file:rounded-xl file:border-0 file:bg-white file:px-3 file:py-2 file:text-sm file:font-bold file:text-slate-950" type="file" accept=".zip,application/zip" onChange={(e) => setFile(e.target.files?.[0] || null)} />
              </label>
              {file && <div className="mt-3 text-xs text-slate-400">Selected: {file.name}</div>}
            </div>
            <Input label="Dataset name" value={datasetName} onChange={(e) => setDatasetName(e.target.value)} />
            <Input label="Validation ratio" type="number" min="0" max="0.5" step="0.05" value={valRatio} onChange={(e) => setValRatio(Number(e.target.value))} />
            <Button disabled={!file || loading} className="w-full" type="submit">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />} Import CVAT zip</Button>
          </form>
        </Card>

        <Card>
          <form onSubmit={buildConfirmed} className="space-y-4">
            <div className="rounded-3xl border border-emerald-300/20 bg-emerald-300/5 p-5">
              <div className="flex items-center gap-3">
                <Hammer className="h-10 w-10 text-emerald-200" />
                <div>
                  <h2 className="text-xl font-black text-white">From confirmed labels</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-400">Best path for production: only confirmed annotation JSON is exported to YOLO train/val data.</p>
                </div>
              </div>
            </div>
            <Input label="Dataset ID" value={confirmedDatasetName} onChange={(e) => setConfirmedDatasetName(e.target.value)} />
            <Input label="Validation ratio" type="number" min="0" max="0.5" step="0.05" value={valRatio} onChange={(e) => setValRatio(Number(e.target.value))} />
            <label className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-200">
              <span><span className="font-bold text-white">Require all 5 fields</span><span className="block text-xs text-slate-400">Recommended, avoids training with missing boxes.</span></span>
              <input className="h-5 w-5 accent-blue-500" type="checkbox" checked={requireAllFields} onChange={(e) => setRequireAllFields(e.target.checked)} />
            </label>
            <Button disabled={!confirmedDatasetName || loading} className="w-full" type="submit">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <DatabaseZap className="h-4 w-4" />} Build confirmed dataset</Button>
          </form>
        </Card>

        <Card>
          {!result ? (
            <EmptyState title="No dataset action yet" description="Import a CVAT zip for quick training, or build from confirmed labels after reviewing imported PDF/CVAT pages." />
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <DatabaseZap className="h-8 w-8 text-emerald-300" />
                <div><div className="text-sm text-slate-400">Dataset created</div><div className="text-2xl font-black text-white">{result.dataset_id}</div></div>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <Stat label="Train images" value={result.train_count} />
                <Stat label="Val images" value={result.val_count} />
                <Stat label="Classes" value={result.class_names?.length || 5} />
              </div>
              {result.class_counts && <pre className="overflow-auto rounded-2xl bg-slate-950 p-4 text-xs text-slate-300">{JSON.stringify(result.class_counts, null, 2)}</pre>}
              {typeof result.skipped_incomplete === 'number' && <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">Skipped incomplete confirmed pages: {result.skipped_incomplete}</div>}
              <div><div className="mb-2 text-sm font-bold text-slate-300">data.yaml</div><pre className="overflow-auto rounded-2xl bg-slate-950 p-4 text-xs text-slate-300">{result.data_yaml}</pre></div>
              {result.missing_labels?.length > 0 && <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">{result.missing_labels.length} images are missing labels. First sample: {result.missing_labels.slice(0, 5).join(', ')}</div>}
            </div>
          )}
        </Card>
      </div>

      {error && <div className="mt-4 rounded-2xl border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-200">{error}</div>}

      <Card className="mt-5">
        <div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-black text-white">Available datasets</h2><Badge tone="blue">{datasets.length} datasets</Badge></div>
        {datasets.length === 0 ? <EmptyState title="No datasets yet" description="Build your first dataset from CVAT or confirmed label review data." /> : (
          <div className="overflow-hidden rounded-2xl border border-white/10"><table className="w-full text-left text-sm"><thead className="bg-white/5 text-slate-400"><tr><th className="p-3">Dataset ID</th><th className="p-3">Train</th><th className="p-3">Val</th><th className="p-3">YAML</th></tr></thead><tbody>{datasets.map((item) => <tr key={item.dataset_id} className="border-t border-white/10"><td className="p-3 font-mono text-white">{item.dataset_id}</td><td className="p-3 text-slate-300">{item.train_count}</td><td className="p-3 text-slate-300">{item.val_count}</td><td className="p-3 text-xs text-slate-400">{item.data_yaml}</td></tr>)}</tbody></table></div>
        )}
      </Card>
    </div>
  )
}

function Stat({ label, value }) {
  return <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4"><div className="text-sm text-slate-400">{label}</div><div className="mt-1 text-2xl font-black text-white">{value}</div></div>
}
