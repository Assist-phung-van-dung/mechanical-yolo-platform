import { useEffect, useState } from 'react'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Dataset from './pages/Dataset'
import Demo from './pages/Demo'
import LabelWorkspace from './pages/LabelWorkspace'
import Library from './pages/Library'
import Review from './pages/Review'
import Models from './pages/Models'
import Train from './pages/Train'

const pages = {
  dashboard: Dashboard,
  library: Library,
  label: LabelWorkspace,
  review: Review,
  demo: Demo,
  dataset: Dataset,
  train: Train,
  models: Models,
}

export default function App() {
  const [activePage, setActivePage] = useState('dashboard')
  const [labelTarget, setLabelTarget] = useState(null)
  const Page = pages[activePage] || Dashboard

  useEffect(() => {
    function openLabel(event) {
      setLabelTarget(event.detail)
      setActivePage('label')
    }
    window.addEventListener('open-label-page', openLabel)
    return () => window.removeEventListener('open-label-page', openLabel)
  }, [])

  return (
    <Layout activePage={activePage} onChangePage={setActivePage}>
      <Page labelTarget={labelTarget} />
    </Layout>
  )
}
