import type { Classified, ModuleRef } from "../pipeline/classify.js";
import type { RetrievedDoc } from "../rule-layer/ruleLayer.js";

export type DraftInput = {
  subject: string;
  body: string;
  prompt: string;
  policyChunks: RetrievedDoc[];
};

export type DraftOutput = {
  body: string;
  citations: string[];
  escalate: boolean;
};

export interface LLMAdapter {
  readonly name: string;
  classify(text: string, modules: ModuleRef[]): Promise<Classified>;
  draft(input: DraftInput): Promise<DraftOutput>;
  recommendTools?(text: string, eligibleToolKeys: string[]): Promise<string[]>;
}
