import { Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import Overview from './pages/Overview'
import Studio from './pages/Studio'
import Compare from './pages/Compare'
import Graph from './pages/Graph'
import Review from './pages/Review'
import Opportunities from './pages/Opportunities'
import Audit from './pages/Audit'
import Benchmark from './pages/Benchmark'
import Architecture from './pages/Architecture'

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/match" element={<Studio />} />
        <Route path="/compare/:id/:candidateId" element={<Compare />} />
        <Route path="/graph" element={<Graph />} />
        <Route path="/graph/:nationalCode" element={<Graph />} />
        <Route path="/review" element={<Review />} />
        <Route path="/opportunities" element={<Opportunities />} />
        <Route path="/audit" element={<Audit />} />
        <Route path="/benchmark" element={<Benchmark />} />
        <Route path="/architecture" element={<Architecture />} />
      </Routes>
    </Layout>
  )
}
