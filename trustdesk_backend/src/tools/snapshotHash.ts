import { createHash } from "node:crypto";

export type PolicyVersion = { doc_id: string; version: string };

export type SnapshotInput = {
  ticketBody: string;
  recordStatus: string | null;
  paymentStatus: string | null;
  policyVersions: PolicyVersion[];
};

export function snapshotHash(input: SnapshotInput): string {
  const payload = {
    ticketBody: input.ticketBody,
    recordStatus: input.recordStatus,
    paymentStatus: input.paymentStatus,
    policyVersions: [...input.policyVersions]
      .map((p) => ({ doc_id: p.doc_id, version: p.version }))
      .sort((a, b) => a.doc_id.localeCompare(b.doc_id)),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function hashesMatch(stored: string, current: string): boolean {
  return stored === current;
}
