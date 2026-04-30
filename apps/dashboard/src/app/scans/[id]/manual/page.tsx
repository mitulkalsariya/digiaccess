// T-043: manual audit findings entry. Plain server-action form.
'use client';
import { useState, type FormEvent } from 'react';

export default function ManualEntryPage({ params }: { params: { id: string } }) {
  const [submitted, setSubmitted] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await fetch(`/api/scans/${params.id}/manual-findings`, {
      method: 'POST',
      body: fd,
    });
    setSubmitted(true);
  }

  if (submitted) return <p role="status">Finding saved.</p>;

  return (
    <section aria-labelledby="manual-heading">
      <h2 id="manual-heading">Add manual finding</h2>
      <form onSubmit={onSubmit} aria-describedby="form-help">
        <p id="form-help">All fields are required.</p>
        <p>
          <label htmlFor="page">Page URL</label>
          <br />
          <input id="page" name="pageUrl" type="url" required />
        </p>
        <p>
          <label htmlFor="defect">Defect description</label>
          <br />
          <textarea id="defect" name="message" required rows={3} cols={60} />
        </p>
        <p>
          <label htmlFor="severity">Severity</label>
          <br />
          <select id="severity" name="severity" required defaultValue="moderate">
            <option value="critical">Critical</option>
            <option value="serious">Serious</option>
            <option value="moderate">Moderate</option>
            <option value="minor">Minor</option>
          </select>
        </p>
        <p>
          <label htmlFor="sc">WCAG SC</label>
          <br />
          <input
            id="sc"
            name="wcagSc"
            required
            pattern="\d\.\d\.\d{1,2}"
            placeholder="e.g. 1.4.3"
          />
        </p>
        <p>
          <label htmlFor="expected">Expected behavior</label>
          <br />
          <textarea id="expected" name="expected" rows={2} cols={60} />
        </p>
        <p>
          <label htmlFor="actual">Actual behavior</label>
          <br />
          <textarea id="actual" name="actual" rows={2} cols={60} />
        </p>
        <p>
          <label htmlFor="screenshot">Screenshot (optional)</label>
          <br />
          <input id="screenshot" name="screenshot" type="file" accept="image/*" />
        </p>
        <button type="submit">Save finding</button>
      </form>
    </section>
  );
}
