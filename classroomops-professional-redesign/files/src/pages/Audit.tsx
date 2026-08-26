import { Download, History } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Card, EmptyState, IconButton, PageHeader, StatusPill } from '../components/Layout'
import { loadAppData } from '../lib/api'

function csvCell(value: unknown) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}

export function Audit() {
  const { data } = useQuery({ queryKey: ['app-data'], queryFn: loadAppData })
  const logs = data?.auditLogs ?? []

  function exportAudit() {
    const rows = [
      ['When', 'Actor', 'Action', 'Entity Type', 'Entity ID', 'Reason'],
      ...logs.map((log) => [log.created_at, log.actor_name, log.action, log.entity_type, log.entity_id, log.reason ?? '']),
    ]
    const blob = new Blob([rows.map((row) => row.map(csvCell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `classroomops-audit-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <PageHeader eyebrow="Governance" title="Audit history" action={<IconButton onClick={exportAudit} disabled={!logs.length}><Download size={16} />Export CSV</IconButton>}>
        A traceable record of manual changes, imports, corrections, and administrative actions.
      </PageHeader>
      <Card>
        <div className="section-title"><div><p className="eyebrow">Recent changes</p><h2>Activity trail</h2></div><StatusPill tone="neutral">{logs.length} events</StatusPill></div>
        {logs.length ? <div className="table-scroll"><table>
          <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Reason</th></tr></thead>
          <tbody>{logs.map((log) => (
            <tr key={log.id}>
              <td>{new Date(log.created_at).toLocaleString('en-IN')}</td>
              <td><strong>{log.actor_name}</strong></td>
              <td>{log.action}</td>
              <td>{log.entity_type}<br /><small>{log.entity_id}</small></td>
              <td>{log.reason ?? 'Recorded by system policy'}</td>
            </tr>
          ))}</tbody>
        </table></div> : <EmptyState title="No audit events yet" body="Administrative changes and imports will appear here automatically." icon={<History size={22} />} />}
      </Card>
    </>
  )
}
