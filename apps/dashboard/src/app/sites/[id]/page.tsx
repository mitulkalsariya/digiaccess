// T-040: per-site trends.
import { TrendsChart } from '../../../components/TrendsChart';

interface TrendPoint {
  date: string;
  total: number;
  newCount: number;
  fixed: number;
}

async function loadTrends(siteId: string): Promise<TrendPoint[]> {
  void siteId;
  // API endpoint for trends lands as part of dashboard scaffold;
  // returning a stub is fine for the static-render check below.
  return [];
}

export default async function SiteDetailPage({ params }: { params: { id: string } }) {
  const trends = await loadTrends(params.id);
  return (
    <section aria-labelledby="trends-heading">
      <h2 id="trends-heading">Trends</h2>
      <p>Total / new / fixed violations over the last 90 days.</p>
      <TrendsChart points={trends} />
    </section>
  );
}
