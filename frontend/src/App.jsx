import { useEffect, useState } from 'react'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Dataset from './pages/Dataset'
import Demo from './pages/Demo'
import LabelWorkspace from './pages/LabelWorkspace'
import Library from './pages/Library'
import Review from './pages/Review'
import BatchEvaluation from './pages/BatchEvaluation'
import BatchHistory from './pages/BatchHistory'
import Models from './pages/Models'
import Train from './pages/Train'

const pages = {
  dashboard: Dashboard,
  library: Library,
  label: LabelWorkspace,
  review: Review,
  batch: BatchEvaluation,
  batchHistory: BatchHistory,
  demo: Demo,
  dataset: Dataset,
  train: Train,
  models: Models,
}

export default function App() {
  const [activePage, setActivePage] = useState('dashboard')
  const [labelTarget, setLabelTarget] = useState(null)
  const [batchJobTarget, setBatchJobTarget] = useState(null)
  const Page = pages[activePage] || Dashboard

  useEffect(() => {
    function openLabel(event) {
      setLabelTarget(event.detail)
      setActivePage('label')
    }
    function openBatch(event) {
      setBatchJobTarget(event.detail)
      setActivePage('batch')
    }
    window.addEventListener('open-label-page', openLabel)
    window.addEventListener('open-batch-job', openBatch)
    return () => {
      window.removeEventListener('open-label-page', openLabel)
      window.removeEventListener('open-batch-job', openBatch)
    }
  }, [])

  return (
    <Layout activePage={activePage} onChangePage={setActivePage}>
      <Page labelTarget={labelTarget} batchJobTarget={batchJobTarget} />
    </Layout>
  )
}
