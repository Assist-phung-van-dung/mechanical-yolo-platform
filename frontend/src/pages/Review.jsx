import { useEffect, useState } from 'react'
import { Eye, RefreshCcw, Search } from 'lucide-react'
import { apiGet } from '../api/client'
import { Badge, Button, Card, EmptyState, Input, PageHeader, Select } from '../components/UI'

export default function Review() {
  const [items, setItems] = useState([])
  const [count, setCount] = useState(0)
  const [status, setStatus] = useState('confirmed')
  const [source, setSource] = useState('')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      if (status) params.set('status', status)
      if (source) params.set('source', source)
      if (query.trim()) params.set('q', query.trim())
      params.set('limit', '1000')
      const data = await apiGet(`/api/label/review?${params.toString()}`)
      setItems(data.items || [])
      setCount(data.count || 0)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  return (
    <div>
      <PageHeader
        eyebrow="Quality control"
        title="Review Labeled"
        description="Re-open confirmed, draft, CVAT-imported, or recently edited pages. This is the safety net for accidental saves and label corrections."
        action={<Button variant="ghost" onClick={load} disabled={loading}><RefreshCcw className="h-4 w-4" /> Refresh</Button>}
      />

      <Card className="mb-5">
        <div className="grid gap-3 lg:grid-cols-[1fr,220px,220px,auto] lg:items-end">
          <Input label="Search" placeholder="filename or pdf_id" value={query} onChange={(e) => setQuery(e.target.value)} />
          <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="confirmed">Confirmed</option>
            <option value="draft">Draft</option>
            <option value="">All</option>
          </Select>
          <Select label="Source" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">All sources</option>
            <option value="human">Human</option>
            <option value="human_confirmed">Human confirmed</option>
            <option value="cvat">CVAT</option>
            <option value="cvat_confirmed">CVAT confirmed</option>
            <option value="yolo">YOLO draft</option>
          </Select>
          <Button onClick={load} disabled={loading}><Search className="h-4 w-4" /> Search</Button>
        </div>
      </Card>

      {error && <div className="mb-4 rounded-2xl border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-200">{error}</div>}

      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-2xl font-black text-white">{count} pages</h2>
          <Badge tone="blue">Review mode</Badge>
        </div>
        {items.length === 0 ? (
          <EmptyState title="No labeled pages found" description="Try changing filters or confirm some annotations first." />
        ) : (
          <div className="overflow-hidden rounded-2xl border border-white/10">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/5 text-slate-400">
                <tr>
                  <th className="p-3">Preview</th>
                  <th className="p-3">PDF</th>
                  <th className="p-3">Page</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Labels</th>
                  <th className="p-3">Sources</th>
                  <th className="p-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={`${item.pdf_id}-${item.page_number}`} className="border-t border-white/10">
                    <td className="p-3">{item.first_page_url ? <img src={item.first_page_url} className="h-16 w-24 rounded-xl object-cover" /> : <div className="h-16 w-24 rounded-xl bg-white/5" />}</td>
                    <td className="p-3"><div className="font-bold text-white">{item.filename}</div><div className="font-mono text-xs text-slate-500">{item.pdf_id}</div></td>
                    <td className="p-3 text-slate-300">{item.page_number}</td>
                    <td className="p-3"><Badge tone={item.status === 'confirmed' ? 'green' : 'yellow'}>{item.status}</Badge></td>
                    <td className="p-3 text-slate-300">{item.label_count}/5</td>
                    <td className="p-3 text-xs text-slate-400">{(item.sources || []).join(', ') || '-'}</td>
                    <td className="p-3"><Button className="px-3 py-2" variant="ghost" onClick={() => window.dispatchEvent(new CustomEvent('open-label-page', { detail: { pdfId: item.pdf_id, page: item.page_number } }))}><Eye className="h-4 w-4" /> Open</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
