import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Background, Controls, type Edge, Handle, type Node, type NodeProps,
  Position, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import clsx from 'clsx'
import { api, type GraphPayload, type Identity, type MaterialRow } from '../lib/api'
import { ATTRIBUTE_LABELS, attributeValue, dnaEntries, num } from '../lib/format'
import { DnaChips, ErrorNote, Loading, Panel } from '../components/ui'
import { WorkflowStrip } from '../components/Layout'

/** Centre node: the national material identity. */
function IdentityNode({ data }: NodeProps) {
  const payload = data as unknown as { code: string; description: string; records: number; cpses: number }
  return (
    <div className="w-[260px] rounded-sm border-2 border-accent/70 bg-navy-850
                    px-4 py-3 shadow-[0_0_30px_rgba(75,134,212,0.18)]">
      <Handle type="target" position={Position.Left} className="!bg-accent !border-0" />
      <Handle type="source" position={Position.Right} className="!bg-accent !border-0" />
      <div className="text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-slate-500">
        National Material Identity
      </div>
      <div className="mt-1 font-mono text-base font-bold text-accent-bright">
        {payload.code}
      </div>
      <p className="mt-1.5 text-[0.7rem] leading-snug text-slate-300">
        {payload.description}
      </p>
      <div className="mt-2 flex gap-3 border-t border-navy-700 pt-2
                      font-mono text-[0.6rem] text-slate-500">
        <span>{num(payload.records)} records</span>
        <span>{payload.cpses} CPSEs</span>
      </div>
    </div>
  )
}

/** CPSE hub node. */
function CpseNode({ data }: NodeProps) {
  const payload = data as unknown as { cpse: string; records: number }
  return (
    <div className="w-[150px] rounded-sm border border-navy-600 bg-navy-800 px-3 py-2">
      <Handle type="target" position={Position.Left} className="!bg-steel-400 !border-0" />
      <Handle type="source" position={Position.Right} className="!bg-steel-400 !border-0" />
      <div className="font-mono text-sm font-bold text-slate-100">{payload.cpse}</div>
      <div className="font-mono text-[0.6rem] text-slate-500">
        {num(payload.records)} legacy records
      </div>
    </div>
  )
}

/** Leaf node: one legacy material in a CPSE system. */
function MaterialNode({ data }: NodeProps) {
  const payload = data as unknown as {
    material: MaterialRow
    selected: boolean
    onSelect: (m: MaterialRow) => void
  }
  const { material } = payload
  return (
    <button type="button" onClick={() => payload.onSelect(material)}
      className={clsx(
        'w-[230px] rounded-sm border px-2.5 py-2 text-left transition-colors',
        payload.selected
          ? 'border-accent bg-accent/10'
          : 'border-navy-700 bg-navy-900 hover:border-steel-400/60')}>
      <Handle type="target" position={Position.Left} className="!bg-navy-600 !border-0" />
      <div className="font-mono text-[0.7rem] font-semibold text-slate-200">
        {material.legacy_material_code}
      </div>
      <div className="mt-0.5 truncate font-mono text-[0.6rem] text-slate-500"
        title={material.legacy_description}>
        {material.legacy_description}
      </div>
      <div className="mt-1 font-mono text-[0.6rem] text-slate-600">
        {material.legacy_uom}
      </div>
    </button>
  )
}

const NODE_TYPES = {
  identity: IdentityNode,
  cpse: CpseNode,
  material: MaterialNode,
}

export default function Graph() {
  const { nationalCode } = useParams()
  const navigate = useNavigate()
  const [identities, setIdentities] = useState<Identity[]>([])
  const [payload, setPayload] = useState<GraphPayload | null>(null)
  const [selected, setSelected] = useState<MaterialRow | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [perCpse, setPerCpse] = useState(2)

  useEffect(() => {
    api.identities()
      .then((data) => {
        setIdentities(data.identities)
        if (!nationalCode && data.identities.length) {
          navigate(`/graph/${data.identities[0].national_code}`, { replace: true })
        }
      })
      .catch(setError)
  }, [nationalCode, navigate])

  useEffect(() => {
    if (!nationalCode) return
    setPayload(null)
    setSelected(null)
    api.graph(nationalCode, perCpse).then(setPayload).catch(setError)
  }, [nationalCode, perCpse])

  const onSelect = useCallback((material: MaterialRow) => setSelected(material), [])

  const { nodes, edges } = useMemo(() => {
    if (!payload) return { nodes: [] as Node[], edges: [] as Edge[] }

    const nodeList: Node[] = []
    const edgeList: Edge[] = []

    const rowHeight = 70
    const totalRows = payload.cpses.reduce(
      (sum, cpse) => sum + Math.max(cpse.materials.length, 1), 0)
    const centreY = (totalRows * rowHeight) / 2

    nodeList.push({
      id: 'identity',
      type: 'identity',
      position: { x: 0, y: centreY - 60 },
      data: {
        code: payload.national_code,
        description: payload.standard_description,
        records: payload.record_count,
        cpses: payload.cpse_count,
      },
      draggable: false,
    })

    let cursor = 0
    payload.cpses.forEach((cpse) => {
      const span = Math.max(cpse.materials.length, 1)
      const cpseY = cursor * rowHeight + (span * rowHeight) / 2 - 24
      const cpseId = `cpse-${cpse.cpse_name}`

      nodeList.push({
        id: cpseId,
        type: 'cpse',
        position: { x: 400, y: cpseY },
        data: { cpse: cpse.cpse_name, records: cpse.record_count },
        draggable: false,
      })
      edgeList.push({
        id: `e-identity-${cpseId}`,
        source: 'identity',
        target: cpseId,
        animated: true,
        style: { stroke: '#2d5a96', strokeWidth: 1.4 },
      })

      cpse.materials.forEach((material, index) => {
        const materialId = `mat-${material.id}`
        nodeList.push({
          id: materialId,
          type: 'material',
          position: { x: 640, y: (cursor + index) * rowHeight },
          data: {
            material,
            selected: selected?.id === material.id,
            onSelect,
          },
          draggable: false,
        })
        edgeList.push({
          id: `e-${cpseId}-${materialId}`,
          source: cpseId,
          target: materialId,
          style: { stroke: '#1d2b48', strokeWidth: 1 },
        })
      })
      cursor += span
    })

    return { nodes: nodeList, edges: edgeList }
  }, [payload, selected, onSelect])

  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState<Node>([])
  const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState<Edge>([])

  useEffect(() => {
    setFlowNodes(nodes)
    setFlowEdges(edges)
  }, [nodes, edges, setFlowNodes, setFlowEdges])

  if (error) return <ErrorNote error={error} />

  return (
    <div className="space-y-5">
      <Panel title="National Identity Graph"
        subtitle="Traceability from one national material identity back to every contributing CPSE system"
        actions={
          <div className="flex items-center gap-2">
            <label className="label" htmlFor="per-cpse">Materials / CPSE</label>
            <select id="per-cpse" value={perCpse}
              onChange={(event) => setPerCpse(Number(event.target.value))}
              className="input !w-auto !py-1 !text-xs">
              {[1, 2, 3, 4, 6].map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </div>
        }>
        <div className="flex flex-wrap gap-1.5">
          {identities.map((identity) => (
            <button key={identity.national_code} type="button"
              onClick={() => navigate(`/graph/${identity.national_code}`)}
              className={clsx('rounded-sm border px-2.5 py-1.5 text-left transition-colors',
                identity.national_code === nationalCode
                  ? 'border-accent/60 bg-accent/15'
                  : 'border-navy-700 bg-navy-850 hover:border-steel-400/50')}>
              <div className={clsx('font-mono text-xs font-semibold',
                identity.national_code === nationalCode
                  ? 'text-accent-bright' : 'text-slate-300')}>
                {identity.national_code}
              </div>
              <div className="text-2xs text-slate-500">
                {identity.cpse_count} CPSE · {num(identity.record_count)} records
              </div>
            </button>
          ))}
        </div>
      </Panel>

      {!payload ? <Loading label="Building identity graph" /> : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_330px]">
          <Panel bodyClassName="!p-0"
            title={payload.national_code}
            subtitle={payload.standard_description}>
            <div className="h-[760px] bg-navy-950/60">
              <ReactFlowProvider>
                <ReactFlow
                  nodes={flowNodes}
                  edges={flowEdges}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  nodeTypes={NODE_TYPES}
                  fitView
                  fitViewOptions={{ padding: 0.06, maxZoom: 1 }}
                  minZoom={0.3}
                  maxZoom={1.6}
                  proOptions={{ hideAttribution: true }}
                  nodesConnectable={false}
                  elementsSelectable={false}>
                  <Background color="#1d2b48" gap={22} size={1} />
                  <Controls className="!bg-navy-850 !border !border-navy-700
                                       [&>button]:!bg-navy-850 [&>button]:!border-navy-700
                                       [&>button]:!fill-steel-300" />
                </ReactFlow>
              </ReactFlowProvider>
            </div>
          </Panel>

          <div className="space-y-5">
            <Panel title={selected ? 'Selected Legacy Material' : 'National Identity'}>
              {selected ? (
                <div className="space-y-3">
                  <div>
                    <div className="label">Originating CPSE</div>
                    <div className="mt-0.5 font-mono text-base font-bold text-slate-100">
                      {selected.cpse_name}
                    </div>
                  </div>
                  <div>
                    <div className="label">Legacy code</div>
                    <div className="value-mono mt-0.5">{selected.legacy_material_code}</div>
                  </div>
                  <div>
                    <div className="label">Legacy description</div>
                    <p className="mt-1 rounded-sm border border-navy-800 bg-navy-900
                                  px-2 py-1.5 font-mono text-2xs leading-relaxed text-slate-300">
                      {selected.legacy_description}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="label">UOM</div>
                      <div className="value-mono mt-0.5">{selected.legacy_uom}</div>
                    </div>
                    <div>
                      <div className="label">ERP group</div>
                      <div className="mt-0.5 text-xs text-slate-200">
                        {selected.legacy_material_group}
                      </div>
                    </div>
                  </div>
                  {selected.dna && (
                    <div className="border-t border-navy-800 pt-3">
                      <div className="label mb-1.5">Material DNA</div>
                      <DnaChips dna={selected.dna} />
                    </div>
                  )}
                  <button type="button" onClick={() => setSelected(null)}
                    className="btn-ghost w-full">Clear selection</button>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs leading-relaxed text-slate-400">
                    Click any legacy material node to trace it back to its
                    originating CPSE system, legacy code and extracted DNA.
                  </p>
                  <div className="border-t border-navy-800 pt-3">
                    <div className="label mb-1.5">Identity DNA</div>
                    <div className="space-y-1.5">
                      {dnaEntries(payload.attributes).map(([key, value]) => (
                        <div key={key}
                          className="flex items-baseline justify-between gap-3">
                          <span className="text-2xs uppercase tracking-wider text-slate-500">
                            {ATTRIBUTE_LABELS[key] ?? key}
                          </span>
                          <span className="font-mono text-xs text-slate-200">
                            {attributeValue(key, value)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 border-t border-navy-800 pt-3">
                    <div>
                      <div className="label">Records</div>
                      <div className="value-mono mt-0.5">{num(payload.record_count)}</div>
                    </div>
                    <div>
                      <div className="label">Legacy identities</div>
                      <div className="value-mono mt-0.5">
                        {num(payload.legacy_identity_count)}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </Panel>

            <Panel title="CPSE Contribution">
              <div className="space-y-1.5">
                {payload.cpses.map((cpse) => (
                  <div key={cpse.cpse_name}
                    className="flex items-center justify-between gap-3 rounded-sm
                               border border-navy-800 bg-navy-850/50 px-2.5 py-1.5">
                    <span className="font-mono text-xs font-semibold text-slate-200">
                      {cpse.cpse_name}
                    </span>
                    <span className="font-mono text-2xs text-slate-500">
                      {num(cpse.record_count)} records
                    </span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        </div>
      )}

      <Panel title="Pipeline Stage">
        <WorkflowStrip active="NATIONAL IDENTITY" />
      </Panel>
    </div>
  )
}
