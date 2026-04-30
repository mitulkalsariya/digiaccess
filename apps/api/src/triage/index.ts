// T-050: triage state machine. T-051: assignment.
import type { Prisma } from '../db.js';

export type TriageState = 'untriaged' | 'confirmed' | 'false-positive' | 'needs-review';

const ALLOWED: Record<TriageState, TriageState[]> = {
  untriaged: ['confirmed', 'false-positive', 'needs-review'],
  'needs-review': ['confirmed', 'false-positive'],
  confirmed: ['false-positive', 'needs-review'],
  'false-positive': ['confirmed', 'needs-review'],
};

export function canTransition(from: TriageState, to: TriageState): boolean {
  return ALLOWED[from].includes(to);
}

export interface TriageInput {
  violationId: string;
  state: TriageState;
  triagedById: string;
  notes?: string;
}

export async function triage(prisma: Prisma, input: TriageInput): Promise<void> {
  const existing = await prisma.violationTriage.findUnique({
    where: { violationId: input.violationId },
  });
  const fromState = (existing?.state as TriageState) ?? 'untriaged';
  if (!canTransition(fromState, input.state)) {
    throw new Error(`invalid transition: ${fromState} → ${input.state}`);
  }
  await prisma.violationTriage.upsert({
    where: { violationId: input.violationId },
    update: {
      state: input.state,
      triagedById: input.triagedById,
      triagedAt: new Date(),
      ...(input.notes ? { notes: input.notes } : {}),
    },
    create: {
      violationId: input.violationId,
      state: input.state,
      triagedById: input.triagedById,
      triagedAt: new Date(),
      ...(input.notes ? { notes: input.notes } : {}),
    },
  });
  await prisma.auditLog.create({
    data: {
      actorId: input.triagedById,
      action: 'violation.triage',
      targetType: 'violation',
      targetId: input.violationId,
      metadata: { from: fromState, to: input.state },
    },
  });
}

export interface AssignInput {
  violationId: string;
  assigneeUserId: string;
  assignedByUserId: string;
}

export async function assignReview(prisma: Prisma, input: AssignInput): Promise<void> {
  await prisma.violationTriage.upsert({
    where: { violationId: input.violationId },
    update: { triagedById: input.assigneeUserId, state: 'needs-review' },
    create: {
      violationId: input.violationId,
      state: 'needs-review',
      triagedById: input.assigneeUserId,
    },
  });
  await prisma.auditLog.create({
    data: {
      actorId: input.assignedByUserId,
      action: 'violation.assign',
      targetType: 'violation',
      targetId: input.violationId,
      metadata: { assignee: input.assigneeUserId },
    },
  });
}

// T-050: confirmed/false-positive findings drop out of default views.
export const DEFAULT_VIEW_STATE_FILTER: ReadonlyArray<TriageState> = [
  'untriaged',
  'needs-review',
  'confirmed',
];
