import Link from 'next/link';

// Server component — fetches sites at request time.
async function loadSites(): Promise<Array<{ id: string; name: string; baseUrl: string }>> {
  // T-038 sites registry — stub list for now.
  return [{ id: 'site-1', name: 'Example App', baseUrl: 'https://example.com' }];
}

export default async function HomePage() {
  const sites = await loadSites();
  return (
    <section aria-labelledby="sites-heading">
      <h2 id="sites-heading">Sites</h2>
      <p>Pick an app to view its scan history and trends.</p>
      <table>
        <caption>Registered sites</caption>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">URL</th>
            <th scope="col">Action</th>
          </tr>
        </thead>
        <tbody>
          {sites.map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td>
              <td>{s.baseUrl}</td>
              <td>
                <Link href={`/sites/${s.id}`}>Open</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
