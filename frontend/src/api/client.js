export async function apiGet(path) {
  const res = await fetch(path)
  if (!res.ok) throw new Error(await safeError(res))
  return res.json()
}

export async function apiPostForm(path, formData) {
  const res = await fetch(path, {
    method: 'POST',
    body: formData,
  })
  if (!res.ok) throw new Error(await safeError(res))
  return res.json()
}

export async function apiPostJson(path, payload = {}) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(await safeError(res))
  return res.json()
}

export async function apiDelete(path) {
  const res = await fetch(path, { method: 'DELETE' })
  if (!res.ok) throw new Error(await safeError(res))
  return res.json()
}

async function safeError(res) {
  try {
    const payload = await res.json()
    return payload.detail || JSON.stringify(payload)
  } catch {
    return `${res.status} ${res.statusText}`
  }
}

export const fieldNames = [
  'id_drawing',
  'spare_part_name',
  'spare_part_number',
  'quantity',
  'material',
]

export const fieldColors = {
  id_drawing: '#38bdf8',
  spare_part_name: '#a78bfa',
  spare_part_number: '#fb7185',
  quantity: '#f59e0b',
  material: '#22c55e',
}

export function formatFieldName(name) {
  return name.replaceAll('_', ' ')
}
