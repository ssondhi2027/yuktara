import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useUnits } from '@/app/auth'
import { SignalsCard } from '@/components/progress/SignalsCard'

/**
 * A client's Insights card for their coach (Clients page, check-in review):
 * the same forecasts, plateaus and insights the client sees on Progress, over
 * the last 12 weeks, in the coach's unit.
 */
export function ClientSignals({ clientId, className }: { clientId: string; className?: string }) {
  const units = useUnits()
  const { data, error } = useQuery({ queryKey: ['client-progress', clientId], queryFn: () => api.clientProgress(clientId, 'p12'), staleTime: 60_000 })
  if (error) return <section className={`card${className ? ` ${className}` : ''}`}><h3>Insights</h3><p className="small muted">Couldn't load insights right now.</p></section>
  if (!data) return <div className={`skeleton${className ? ` ${className}` : ''}`} style={{ height: 160 }} />
  return <SignalsCard d={data} units={units} voice="coach" className={className} />
}
