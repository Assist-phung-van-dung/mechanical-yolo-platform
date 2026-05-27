import { useMemo, useState } from 'react'
import { CheckCircle2, Download, FileUp, Loader2, WandSparkles, Zap } from 'lucide-react'
import { apiPostForm, fieldColors, fieldNames, formatFieldName } from '../api/client'
import { Badge, Button, Card, EmptyState, Input, PageHeader } from '../components/UI'

export default function Demo() {
  const [file, setFile] = useState(null)
  const [dpi, setDpi] = useState(300)
  const [conf, setConf] = useState(0.25)
  const [imgsz, setImgsz] = useState(1536)
  const [ocr, setOcr] = useState(true)
  const [ocrEngine, setOcrEngine] = useState('auto')
  const [includeBase64, setIncludeBase64] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [activePage, setActivePage] = useState(0)

  async function submit(e) {
    e.preventDefault()
    if (!file) return
    setLoading(true)
    setError('')
    setResult(null)
    setActivePage(0)
    const form = new FormData()
    form.append('file', file)
    form.append('dpi', dpi)
    form.append('conf', conf)
    form.append('imgsz', imgsz)
    form.append('ocr', String(ocr))
    form.append('ocr_engine', ocrEngine)
    form.append('include_base64', String(includeBase64))
    try {
      const data = await apiPostForm('/api/extract', form)
      setResult(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const page = result?.pages?.[activePage]
  const detectedCount = useMemo(() => {
    if (!result?.fields) return 0
    return Object.values(result.fields).filter((item) => item.detected).length
  }, [result])

  const ocrOk = result?.ocr?.enabled ? result?.ocr?.ok : false

  return (
    <div>
      <PageHeader
        eyebrow="Live demo"
        title="Upload PDF and extract 5 fields"
        description="Render PDF to PNG, detect five fields with YOLO, crop each field image, then call the external OCR/Qwen API to return coordinates, images, and text values."
      />

      <div className="grid gap-5 xl:grid-cols-[430px,1fr]">
        <Card>
          <form onSubmit={submit} className="space-y-4">
            <div className="rounded-3xl border border-dashed border-cyan-300/30 bg-cyan-300/5 p-5 text-center">
              <FileUp className="mx-auto mb-3 h-10 w-10 text-cyan-200" />
              <label className="block cursor-pointer">
                <span className="text-sm font-bold text-white">Choose mechanical drawing PDF</span>
                <input
                  className="mt-4 block w-full rounded-2xl border border-white/10 bg-slate-950/70 p-3 text-sm text-slate-300 file:mr-4 file:rounded-xl file:border-0 file:bg-white file:px-3 file:py-2 file:text-sm file:font-bold file:text-slate-950"
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
              </label>
              {file && <div className="mt-3 text-xs text-slate-400">Selected: {file.name}</div>}
            </div>

            <div className="grid grid-cols-3 gap-3">
              <Input label="DPI" type="number" value={dpi} onChange={(e) => setDpi(Number(e.target.value))} />
              <Input label="Conf" type="number" step="0.01" value={conf} onChange={(e) => setConf(Number(e.target.value))} />
              <Input label="Img size" type="number" value={imgsz} onChange={(e) => setImgsz(Number(e.target.value))} />
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
              <label className="mb-3 flex items-center justify-between text-sm text-slate-200">
                <span>
                  <span className="font-bold text-white">Run OCR/Qwen API</span>
                  <span className="block text-xs text-slate-400">Send the five YOLO crops to /api/ocr-five-fields.</span>
                </span>
                <input className="h-5 w-5 accent-blue-500" type="checkbox" checked={ocr} onChange={(e) => setOcr(e.target.checked)} />
              </label>
              <Input label="OCR engine" value={ocrEngine} onChange={(e) => setOcrEngine(e.target.value)} />
              <label className="mt-3 flex items-center justify-between rounded-2xl border border-white/10 bg-slate-950/40 p-3 text-xs text-slate-300">
                <span>Include crop base64 in JSON</span>
                <input className="h-4 w-4 accent-cyan-400" type="checkbox" checked={includeBase64} onChange={(e) => setIncludeBase64(e.target.checked)} />
              </label>
            </div>

            <Button disabled={!file || loading} className="w-full" type="submit">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <WandSparkles className="h-4 w-4" />}
              {loading ? 'Processing...' : 'Run extraction'}
            </Button>
          </form>

          {error && <div className="mt-4 rounded-2xl border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-200">{error}</div>}
          {result?.warning && <div className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-200">{result.warning}</div>}
        </Card>

        <Card>
          {!result ? (
            <EmptyState title="No extraction result yet" description="Upload a PDF to preview rendered pages, YOLO boxes, field crops, OCR/Qwen values, and final API JSON." />
          ) : (
            <div className="space-y-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-sm text-slate-400">Request ID</div>
                  <div className="font-mono text-lg font-black text-white">{result.request_id}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge tone={result.model_loaded ? 'green' : 'yellow'}>{result.model_loaded ? 'model ready' : 'model missing'}</Badge>
                  <Badge tone={detectedCount === 5 ? 'green' : 'yellow'}>{detectedCount}/5 detected</Badge>
                  <Badge tone={!result.ocr?.enabled ? 'slate' : ocrOk ? 'green' : 'yellow'}>
                    {!result.ocr?.enabled ? 'ocr off' : ocrOk ? 'ocr ok' : 'ocr warning'}
                  </Badge>
                </div>
              </div>

              {result.ocr?.enabled && (
                <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-3 text-xs text-slate-300">
                  <div className="flex flex-wrap items-center gap-2">
                    <Zap className="h-4 w-4 text-cyan-200" />
                    <span className="font-bold text-white">OCR/Qwen</span>
                    <span>engine={result.ocr.engine || ocrEngine}</span>
                    <span className="text-slate-500">endpoint={result.ocr.endpoint || 'not configured'}</span>
                  </div>
                  {result.ocr.error && <div className="mt-2 text-amber-200">{result.ocr.error}</div>}
                </div>
              )}

              {result.pages?.length > 1 && (
                <div className="flex gap-2 overflow-x-auto">
                  {result.pages.map((p, idx) => (
                    <button
                      key={p.page_number}
                      onClick={() => setActivePage(idx)}
                      className={`rounded-2xl px-4 py-2 text-sm font-bold ${activePage === idx ? 'bg-white text-slate-950' : 'bg-white/10 text-white'}`}
                    >
                      Page {p.page_number}
                    </button>
                  ))}
                </div>
              )}

              {page && <PagePreview page={page} />}
            </div>
          )}
        </Card>
      </div>

      {result && (
        <div className="mt-5 grid gap-5 xl:grid-cols-5">
          {fieldNames.map((name) => (
            <FieldCard key={name} field={name} item={result.fields?.[name]} />
          ))}
        </div>
      )}

      {result && (
        <Card className="mt-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xl font-black text-white">API JSON</h2>
            <Button variant="ghost" onClick={() => navigator.clipboard.writeText(JSON.stringify(result, null, 2))}>Copy full JSON</Button>
          </div>
          <pre className="max-h-96 overflow-auto rounded-2xl bg-slate-950 p-4 text-xs text-slate-300">{JSON.stringify(result, null, 2)}</pre>
        </Card>
      )}
    </div>
  )
}

function PagePreview({ page }) {
  return (
    <div className="overflow-hidden rounded-3xl border border-white/10 bg-slate-950">
      <div className="relative">
        <img src={page.image_url} alt={`Page ${page.page_number}`} className="block w-full" />
        {page.detections?.map((det) => (
          <Box key={`${det.field}-${det.page_number}`} det={det} width={page.width} height={page.height} />
        ))}
      </div>
    </div>
  )
}

function Box({ det, width, height }) {
  const [x1, y1, x2, y2] = det.bbox
  const style = {
    left: `${(x1 / width) * 100}%`,
    top: `${(y1 / height) * 100}%`,
    width: `${((x2 - x1) / width) * 100}%`,
    height: `${((y2 - y1) / height) * 100}%`,
    borderColor: fieldColors[det.field] || '#67e8f9',
    backgroundColor: `${fieldColors[det.field] || '#67e8f9'}22`,
  }
  return (
    <div className="absolute border-2 shadow-glow" style={style} title={`${det.field} ${(det.confidence * 100).toFixed(0)}%`}>
      <div className="absolute -right-2 -top-2 h-3 w-3 rounded-full border border-slate-950" style={{ backgroundColor: fieldColors[det.field] || '#67e8f9' }} />
    </div>
  )
}

function FieldCard({ field, item }) {
  const detected = item?.detected
  const value = item?.value || item?.text || item?.predicted_text
  const ocrScore = item?.ocr_confidence_score
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: fieldColors[field] }} />
          <h3 className="break-all text-sm font-black text-white">{formatFieldName(field)}</h3>
        </div>
        <Badge tone={detected ? 'green' : 'red'}>{detected ? 'ok' : 'miss'}</Badge>
      </div>
      {detected ? (
        <div className="space-y-3">
          {item.crop_url && (
            <a href={item.crop_url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-2xl border border-white/10 bg-slate-950">
              <img src={item.crop_url} alt={field} className="h-28 w-full object-contain" />
            </a>
          )}

          <Metric label="YOLO confidence" value={item.confidence != null ? `${(item.confidence * 100).toFixed(1)}%` : '-'} />

          <div>
            <div className="mb-1 text-xs text-slate-400">Final value</div>
            <div className="min-h-10 rounded-2xl bg-slate-950/70 p-3 text-sm font-bold text-white">{value || 'No OCR value'}</div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Metric label="OCR score" value={ocrScore != null ? Number(ocrScore).toFixed(3) : '-'} />
            <Metric label="Source" value={item.final_source || '-'} />
          </div>

          {item.predicted_text && item.predicted_text !== value && (
            <div>
              <div className="mb-1 text-xs text-slate-400">Predicted text</div>
              <div className="rounded-2xl bg-slate-950/50 p-3 text-xs text-slate-200">{item.predicted_text}</div>
            </div>
          )}

          {item.value_detector?.used && (
            <div className="rounded-2xl border border-cyan-300/20 bg-cyan-300/5 p-3 text-xs text-cyan-100">
              <div className="mb-1 flex items-center gap-2 font-bold"><CheckCircle2 className="h-4 w-4" /> Value detector used</div>
              <div>device: {item.value_detector.device || '-'}</div>
              {item.value_detector.box && <div>box: [{item.value_detector.box.join(', ')}]</div>}
            </div>
          )}

          {item.crop_url && (
            <a href={item.crop_url} download className="inline-flex items-center gap-2 text-xs font-bold text-cyan-200">
              <Download className="h-4 w-4" /> Download crop
            </a>
          )}
        </div>
      ) : (
        <p className="text-sm leading-6 text-slate-400">Not detected on this PDF. Try lower confidence or add this layout to the review/label queue.</p>
      )}
    </Card>
  )
}

function Metric({ label, value }) {
  return (
    <div className="rounded-2xl bg-slate-950/50 p-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 break-all text-sm font-black text-slate-100">{value}</div>
    </div>
  )
}
