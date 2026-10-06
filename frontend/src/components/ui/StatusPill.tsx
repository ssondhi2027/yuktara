import type { ClientWeekStatus } from '@/lib/api'

const LABEL: Record<ClientWeekStatus, string> = {
  on_track: 'On track',
  slipping: 'Slipping',
  overdue: 'Overdue',
  awaiting: 'Awaiting',
}

export function StatusPill({ status }: { status: ClientWeekStatus }) {
  return <span className={`pill ${status.replace('_', '-')}`}>{LABEL[status]}</span>
}
