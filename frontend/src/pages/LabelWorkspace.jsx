import { useCallback, useEffect, useRef, useState } from 'react'
import { Image as KonvaImage, Layer, Rect, Stage, Transformer } from 'react-konva'
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Crosshair,
  History,
  Loader2,
  MousePointer2,
  RefreshCcw,
  RotateCcw,
  Save,
  Shuffle,
  Sparkles,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { apiGet, apiPostForm, apiPostJson, fieldColors, fieldNames, formatFieldName } from '../api/client'
import { Badge, Button, Card, EmptyState, Input, PageHeader, Select } from '../components/UI'

function useImage(url) {
  const [image, setImage] = useState(null)
  useEffect(() => {
    if (!url) {
      setImage(null)
      return
    }
    const img = new window.Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => setImage(img)
    img.src = url
  }, [url])
  return image
}

const queueModes = [
  ['need_review', 'Need review'],
  ['unlabeled', 'Unlabeled'],
  ['missing_fields', 'Missing fields'],
  ['low_confidence', 'Low confidence'],
  ['draft', 'Draft'],
  ['confirmed', 'Confirmed review'],
  ['recently_edited', 'Recently edited'],
  ['random', 'Random'],
]

export default function LabelWorkspace({ labelTarget }) {
  const [pdfId, setPdfId] = useState('')
  const [pageNumber, setPageNumber] = useState(1)
  const [payload, setPayload] = useState(null)
  const [labels, setLabels] = useState({})
  const [selectedField, setSelectedField] = useState('id_drawing')
  const [tool, setTool] = useState('select')
  const [mode, setMode] = useState('need_review')
  const [conf, setConf] = useState(0.25)
  const [imgsz, setImgsz] = useState(1536)
  const [replacePrelabel, setReplacePrelabel] = useState(false)
  const [protectHumanLabels, setProtectHumanLabels] = useState(true)
  const [autoNext, setAutoNext] = useState(true)
  const [allowPartial, setAllowPartial] = useState(true)
  const [zoom, setZoom] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [draftBox, setDraftBox] = useState(null)
  const [history, setHistory] = useState([])
  const [containerWidth, setContainerWidth] = useState(860)
  const wrapRef = useRef(null)
  const drawingRef = useRef(null)

  useEffect(() => {
    const ro = new ResizeObserver((entries) => {
      const width = entries?.[0]?.contentRect?.width
      if (width) setContainerWidth(Math.max(320, Math.floor(width)))
    })
    if (wrapRef.current) ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (labelTarget?.pdfId) {
      setPdfId(labelTarget.pdfId)
      setPageNumber(labelTarget.page || 1)
      loadPage(labelTarget.pdfId, labelTarget.page || 1).catch((err) => setError(err.message))
    }
  }, [labelTarget])

  useEffect(() => {
    function onKey(e) {
      if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return
      const idx = Number(e.key)
      if (idx >= 1 && idx <= 5) {
        setSelectedField(fieldNames[idx - 1])
        setTool('draw')
      }
      if (e.key.toLowerCase() === 'd') setTool('draw')
      if (e.key.toLowerCase() === 'v') setTool('select')
      if (e.key.toLowerCase() === 'r') prelabel()
      if (e.key.toLowerCase() === 'n') nextTarget()
      if (e.key === 'Enter') save('confirmed')
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        save('draft')
      }
      if (e.key === 'Delete' || e.key === 'Backspace') clearField(selectedField)
      if (e.key === '+') setZoom((z) => Math.min(3, z + 0.2))
      if (e.key === '-') setZoom((z) => Math.max(0.35, z - 0.2))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  async function loadPage(id = pdfId, page = pageNumber) {
    if (!id) return
    setLoading(true)
    setError('')
    setMessage('')
    try {
      const data = await apiGet(`/api/label/${id}/${page}`)
      setPayload(data)
      setLabels(data.annotation?.labels || {})
      setPdfId(id)
      setPageNumber(page)
      setDraftBox(null)
      await loadHistory(id, page)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function loadHistory(id = pdfId, page = pageNumber) {
    if (!id) return
    try {
      const data = await apiGet(`/api/label/${id}/${page}/history`)
      setHistory(data.history || [])
    } catch {
      setHistory([])
    }
  }

  async function nextTarget(nextMode = mode) {
    setLoading(true)
    setError('')
    setMessage('')
    try {
      const data = await apiGet(`/api/label/next?mode=${encodeURIComponent(nextMode)}`)
      setPayload(data)
      setLabels(data.annotation?.labels || {})
      setPdfId(data.document.pdf_id)
      setPageNumber(data.page.page_number)
      setDraftBox(null)
      await loadHistory(data.document.pdf_id, data.page.page_number)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function save(status = 'draft') {
    if (!payload) return
    setLoading(true)
    setError('')
    try {
      if (status === 'confirmed' && autoNext) {
        const result = await apiPostJson(`/api/label/${payload.document.pdf_id}/${payload.page.page_number}/confirm-next`, {
          labels,
          queue_mode: mode,
          allow_partial: allowPartial,
        })
        setMessage('Confirmed. Loaded next item automatically.')
        if (result.next) {
          setPayload(result.next)
          setLabels(result.next.annotation?.labels || {})
          setPdfId(result.next.document.pdf_id)
          setPageNumber(result.next.page.page_number)
          setDraftBox(null)
          await loadHistory(result.next.document.pdf_id, result.next.page.page_number)
        } else {
          setPayload((prev) => ({ ...prev, annotation: result.saved }))
          setLabels(result.saved?.labels || {})
          setMessage('Confirmed. No more items in this queue.')
          await loadHistory(payload.document.pdf_id, payload.page.page_number)
        }
      } else {
        const ann = await apiPostJson(`/api/label/${payload.document.pdf_id}/${payload.page.page_number}/save`, { labels, status })
        setPayload((prev) => ({ ...prev, annotation: ann }))
        setLabels(ann.labels || {})
        setMessage(status === 'confirmed' ? 'Labels confirmed and saved.' : 'Draft saved.')
        await loadHistory(payload.document.pdf_id, payload.page.page_number)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function prelabel() {
    if (!payload) return
    const form = new FormData()
    form.append('conf', String(conf))
    form.append('imgsz', String(imgsz))
    form.append('replace', String(replacePrelabel))
    form.append('protect_human_labels', String(protectHumanLabels))
    setLoading(true)
    setError('')
    try {
      const ann = await apiPostForm(`/api/label/${payload.document.pdf_id}/${payload.page.page_number}/prelabel`, form)
      setPayload((prev) => ({ ...prev, annotation: ann }))
      setLabels(ann.labels || {})
      setMessage('YOLO pre-label completed. Human/CVAT confirmed boxes were protected.')
      await loadHistory(payload.document.pdf_id, payload.page.page_number)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function restore(versionId) {
    if (!payload || !versionId) return
    const form = new FormData()
    form.append('version_id', versionId)
    setLoading(true)
    setError('')
    try {
      const ann = await apiPostForm(`/api/label/${payload.document.pdf_id}/${payload.page.page_number}/restore`, form)
      setPayload((prev) => ({ ...prev, annotation: ann }))
      setLabels(ann.labels || {})
      setMessage('Restored annotation version.')
      await loadHistory(payload.document.pdf_id, payload.page.page_number)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function clearField(field) {
    setLabels((prev) => {
      const next = { ...prev }
      delete next[field]
      return next
    })
  }

  function updateFieldBBox(field, bbox, source = 'human') {
    setLabels((prev) => ({
      ...prev,
      [field]: {
        ...(prev[field] || {}),
        bbox: bbox.map((v) => Math.round(v)),
        source,
        confidence: source === 'human' ? 1 : prev[field]?.confidence ?? null,
        confirmed: false,
      },
    }))
  }

  const page = payload?.page
  const image = useImage(page?.image_url)
  const baseScale = page ? Math.min(1, (containerWidth - 24) / page.width) : 1
  const scale = baseScale * zoom
  const stageWidth = page ? Math.max(containerWidth - 24, page.width * scale) : containerWidth - 24
  const stageHeight = page ? page.height * scale : 500
  const detectedCount = fieldNames.filter((name) => labels?.[name]?.bbox).length

  const pointerImagePos = useCallback((stage) => {
    const p = stage.getPointerPosition()
    if (!p) return null
    return { x: p.x / scale, y: p.y / scale }
  }, [scale])

  function onMouseDown(e) {
    if (!page || tool !== 'draw') return
    const pos = pointerImagePos(e.target.getStage())
    if (!pos) return
    drawingRef.current = { x: pos.x, y: pos.y }
    setDraftBox([pos.x, pos.y, pos.x, pos.y])
  }

  function onMouseMove(e) {
    if (!drawingRef.current || tool !== 'draw') return
    const pos = pointerImagePos(e.target.getStage())
    if (!pos) return
    const start = drawingRef.current
    setDraftBox([start.x, start.y, pos.x, pos.y])
  }

  function onMouseUp() {
    if (!drawingRef.current || !draftBox) return
    const [x1, y1, x2, y2] = draftBox
    const box = [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)]
    if (box[2] - box[0] > 3 && box[3] - box[1] > 3) updateFieldBBox(selectedField, box, 'human')
    drawingRef.current = null
    setDraftBox(null)
    setTool('select')
  }

  return (
    <div>
      <PageHeader
        eyebrow="Human-in-the-loop labeling"
        title="Label Workspace"
        description="YOLO proposes five boxes first. You confirm if correct, redraw if wrong, and the workspace automatically moves to the next PDF/page. Canvas stays clean: colored boxes only, no text labels covering the drawing."
        action={<Button variant="ghost" onClick={() => loadPage()} disabled={!pdfId || loading}><RefreshCcw className="h-4 w-4" /> Reload</Button>}
      />

      <div className="grid gap-5 xl:grid-cols-[1fr,400px]">
        <Card className="min-w-0">
          <div className="mb-4 grid gap-3 md:grid-cols-[1fr,120px,auto]">
            <Input label="PDF ID" placeholder="Paste pdf_id or use queue" value={pdfId} onChange={(e) => setPdfId(e.target.value)} />
            <Input label="Page" type="number" min="1" value={pageNumber} onChange={(e) => setPageNumber(Number(e.target.value))} />
            <div className="flex items-end gap-2">
              <Button onClick={() => loadPage()} disabled={!pdfId || loading}>Open</Button>
              <Button variant="ghost" onClick={() => setPageNumber((p) => Math.max(1, p - 1))}>Prev</Button>
              <Button variant="ghost" onClick={() => setPageNumber((p) => p + 1)}>Next</Button>
            </div>
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Select value={mode} onChange={(e) => setMode(e.target.value)} className="min-w-48">
              {queueModes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
            <Button variant="ghost" onClick={() => nextTarget()} disabled={loading}><Shuffle className="h-4 w-4" /> Load queue</Button>
            <Button variant={tool === 'select' ? 'white' : 'ghost'} onClick={() => setTool('select')}><MousePointer2 className="h-4 w-4" /> Select</Button>
            <Button variant={tool === 'draw' ? 'white' : 'ghost'} onClick={() => setTool('draw')}><Crosshair className="h-4 w-4" /> Draw {formatFieldName(selectedField)}</Button>
            <Button variant="ghost" onClick={() => setZoom((z) => Math.max(0.35, z - 0.2))}><ZoomOut className="h-4 w-4" /></Button>
            <Button variant="ghost" onClick={() => setZoom((z) => Math.min(3, z + 0.2))}><ZoomIn className="h-4 w-4" /></Button>
            <Badge tone={detectedCount === 5 ? 'green' : 'yellow'}>{detectedCount}/5 boxes</Badge>
            {payload?.annotation?.status && <Badge tone={payload.annotation.status === 'confirmed' ? 'green' : 'yellow'}>{payload.annotation.status}</Badge>}
          </div>

          {payload?.document && (
            <div className="mb-4 rounded-2xl border border-white/10 bg-slate-950/50 p-3 text-xs text-slate-300">
              <span className="font-bold text-white">{payload.document.filename}</span>
              <span className="mx-2 text-slate-600">•</span>
              <span className="font-mono">{payload.document.pdf_id}</span>
              <span className="mx-2 text-slate-600">•</span>
              <span>Page {payload.page?.page_number}</span>
            </div>
          )}

          {error && <div className="mb-4 rounded-2xl border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-200">{error}</div>}
          {message && <div className="mb-4 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-sm text-emerald-100">{message}</div>}

          {!payload ? (
            <EmptyState title="No page selected" description="Import PDFs/CVAT data, then open a page by pdf_id or load an item from the review queue." />
          ) : (
            <div className="overflow-auto rounded-3xl border border-white/10 bg-slate-950 p-3" ref={wrapRef}>
              <Stage width={stageWidth} height={stageHeight} onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp}>
                <Layer>
                  {image && <KonvaImage image={image} x={0} y={0} width={page.width * scale} height={page.height * scale} />}
                  {fieldNames.map((field) => {
                    const item = labels?.[field]
                    if (!item?.bbox) return null
                    return (
                      <BBoxRect
                        key={field}
                        field={field}
                        item={item}
                        bbox={item.bbox}
                        selected={selectedField === field}
                        scale={scale}
                        draggable={tool === 'select'}
                        onSelect={() => setSelectedField(field)}
                        onChange={(bbox) => updateFieldBBox(field, bbox, 'human')}
                      />
                    )
                  })}
                  {draftBox && <DraftRect bbox={draftBox} scale={scale} field={selectedField} />}
                </Layer>
              </Stage>
            </div>
          )}
        </Card>

        <Card>
          <div className="mb-4">
            <h2 className="text-2xl font-black text-white">Fields</h2>
            <p className="mt-1 text-sm text-slate-400">Hotkeys: 1-5 select fields, D draw, V select, Enter confirm, Ctrl+S draft, R pre-label, N next.</p>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-3">
            <Input label="Prelabel conf" type="number" step="0.01" value={conf} onChange={(e) => setConf(Number(e.target.value))} />
            <Input label="Img size" type="number" value={imgsz} onChange={(e) => setImgsz(Number(e.target.value))} />
          </div>

          <div className="mb-4 space-y-2">
            <CheckToggle label="Auto next after confirm" checked={autoNext} onChange={setAutoNext} />
            <CheckToggle label="Allow partial confirm" checked={allowPartial} onChange={setAllowPartial} />
            <CheckToggle label="Protect human/CVAT labels" checked={protectHumanLabels} onChange={setProtectHumanLabels} />
            <CheckToggle label="Replace YOLO draft boxes" checked={replacePrelabel} onChange={setReplacePrelabel} />
          </div>

          <Button className="mb-4 w-full" variant="ghost" disabled={!payload || loading} onClick={prelabel}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Run YOLO pre-label</Button>

          <div className="space-y-3">
            {fieldNames.map((field) => <FieldEditor key={field} field={field} item={labels[field]} active={selectedField === field} onSelect={() => setSelectedField(field)} onDraw={() => { setSelectedField(field); setTool('draw') }} onClear={() => clearField(field)} />)}
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <Button variant="ghost" disabled={!payload || loading} onClick={() => save('draft')}><Save className="h-4 w-4" /> Save draft</Button>
            <Button disabled={!payload || loading} onClick={() => save('confirmed')}><CheckCircle2 className="h-4 w-4" /> Confirm{autoNext ? ' & Next' : ''}</Button>
          </div>

          <div className="mt-5 rounded-2xl border border-white/10 bg-slate-950/50 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-bold text-white"><History className="h-4 w-4" /> History</div>
              <Button className="px-3 py-2" variant="ghost" disabled={!payload} onClick={() => loadHistory()}><RefreshCcw className="h-4 w-4" /></Button>
            </div>
            {history.length === 0 ? <p className="text-xs text-slate-500">No saved versions yet.</p> : (
              <div className="max-h-52 space-y-2 overflow-auto">
                {history.slice(0, 20).map((item) => (
                  <div key={item.version_id} className="flex items-center justify-between gap-2 rounded-xl bg-white/5 p-2 text-xs text-slate-300">
                    <div>
                      <div className="font-mono text-[11px] text-slate-400">{item.version_id}</div>
                      <div>{item.status || 'unknown'} · {item.label_count} labels</div>
                    </div>
                    <Button className="px-3 py-2" variant="ghost" onClick={() => restore(item.version_id)}><RotateCcw className="h-4 w-4" /> Restore</Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>
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

function BBoxRect({ field, item, bbox, selected, scale, draggable, onSelect, onChange }) {
  const shapeRef = useRef(null)
  const transformerRef = useRef(null)
  const [x1, y1, x2, y2] = bbox
  const color = fieldColors[field] || '#38bdf8'
  const isDraft = item?.source === 'yolo'
  const isConfirmed = Boolean(item?.confirmed)

  useEffect(() => {
    if (selected && transformerRef.current && shapeRef.current) {
      transformerRef.current.nodes([shapeRef.current])
      transformerRef.current.getLayer().batchDraw()
    }
  }, [selected])

  function commit(node) {
    const scaleX = node.scaleX()
    const scaleY = node.scaleY()
    node.scaleX(1)
    node.scaleY(1)
    const next = [
      node.x() / scale,
      node.y() / scale,
      (node.x() + Math.max(4, node.width() * scaleX)) / scale,
      (node.y() + Math.max(4, node.height() * scaleY)) / scale,
    ]
    onChange(next)
  }

  return (
    <>
      <Rect
        ref={shapeRef}
        x={x1 * scale}
        y={y1 * scale}
        width={(x2 - x1) * scale}
        height={(y2 - y1) * scale}
        stroke={color}
        strokeWidth={selected ? 4 : 2}
        dash={isDraft && !isConfirmed ? [10, 6] : []}
        fill={`${color}${selected ? '30' : '16'}`}
        draggable={draggable}
        onClick={onSelect}
        onTap={onSelect}
        onDragEnd={(e) => commit(e.target)}
        onTransformEnd={(e) => commit(e.target)}
      />
      {selected && <Transformer ref={transformerRef} rotateEnabled={false} boundBoxFunc={(oldBox, newBox) => (newBox.width < 8 || newBox.height < 8 ? oldBox : newBox)} />}
    </>
  )
}

function DraftRect({ bbox, scale, field }) {
  const [x1, y1, x2, y2] = bbox
  const left = Math.min(x1, x2) * scale
  const top = Math.min(y1, y2) * scale
  const width = Math.abs(x2 - x1) * scale
  const height = Math.abs(y2 - y1) * scale
  const color = fieldColors[field] || '#38bdf8'
  return <Rect x={left} y={top} width={width} height={height} stroke={color} dash={[8, 6]} strokeWidth={3} fill={`${color}18`} />
}

function FieldEditor({ field, item, active, onSelect, onDraw, onClear }) {
  const color = fieldColors[field] || '#38bdf8'
  return (
    <div className={`rounded-2xl border p-3 transition ${active ? 'border-cyan-300 bg-cyan-300/10' : 'border-white/10 bg-slate-950/50'}`}>
      <button onClick={onSelect} className="flex w-full items-center justify-between gap-3 text-left">
        <div className="flex items-center gap-3">
          <span className="h-4 w-4 rounded-full" style={{ background: color }} />
          <div>
            <div className="break-all text-sm font-black text-white">{formatFieldName(field)}</div>
            <div className="mt-1 text-xs text-slate-400">{item?.bbox ? `${item.source || 'human'} · ${item.confidence ? `${(item.confidence * 100).toFixed(0)}%` : 'manual'}` : 'missing'}</div>
          </div>
        </div>
        <Badge tone={item?.bbox ? 'green' : 'red'}>{item?.bbox ? 'box' : 'miss'}</Badge>
      </button>
      <div className="mt-3 flex gap-2">
        <Button variant="ghost" className="flex-1 px-3 py-2" onClick={onDraw}><Crosshair className="h-4 w-4" /> Draw</Button>
        <Button variant="danger" className="px-3 py-2" disabled={!item?.bbox} onClick={onClear}><Trash2 className="h-4 w-4" /></Button>
      </div>
    </div>
  )
}
