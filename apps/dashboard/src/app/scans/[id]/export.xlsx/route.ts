import { api } from '../../../../lib/api';
import { buildExcelReport, violationToReportFinding } from '../../../../lib/excel-report';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const scan = await api.getScan(params.id);
  const automated = scan.violations
    .filter((v) => !v.sources.includes('manual'))
    .map((v) => violationToReportFinding(v));
  const manual = scan.violations
    .filter((v) => v.sources.includes('manual'))
    .map((v) => violationToReportFinding(v));

  const buf = await buildExcelReport({
    status: [
      {
        url: scan.url,
        results: { 'Automated Tools': scan.status === 'completed' ? 'Done' : 'In Progress' },
      },
    ],
    automated,
    manual,
  });
  return new Response(new Uint8Array(buf), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="a11y-${params.id}.xlsx"`,
    },
  });
}
