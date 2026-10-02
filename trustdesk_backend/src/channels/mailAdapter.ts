export type NormalizedInbound = {
  fromEmail: string;
  fromName?: string | null;
  subject: string;
  body: string;
  externalId: string;
};

export interface MailAdapter {
  readonly provider: "demo" | "imap" | "gmail";
  pullUnprocessed(mailboxId: string): Promise<NormalizedInbound[]>;
}

export class StubMailboxAdapter implements MailAdapter {
  constructor(readonly provider: "imap" | "gmail") {}

  async pullUnprocessed(): Promise<NormalizedInbound[]> {
    throw new Error(`${this.provider} mailbox adapter is not configured. Use the demo provider for this build.`);
  }
}

export interface ChannelAdapter {
  readonly type: string;
  normalize(input: { subject: string; body: string; from?: string }): { subject: string; body: string };
}

export class WebFormAdapter implements ChannelAdapter {
  readonly type = "web_form";
  normalize(input: { subject: string; body: string }) {
    return { subject: input.subject, body: input.body };
  }
}

export class ChatAdapter implements ChannelAdapter {
  readonly type = "chat";
  normalize(input: { subject: string; body: string }) {
    return { subject: input.subject || "Chat message", body: input.body };
  }
}

export class SlackAdapter implements ChannelAdapter {
  readonly type = "slack";
  normalize(input: { subject: string; body: string }) {
    return { subject: input.subject || "Slack message", body: input.body };
  }
}

export class WhatsAppAdapter implements ChannelAdapter {
  readonly type = "whatsapp";
  normalize(input: { subject: string; body: string }) {
    return { subject: input.subject || "WhatsApp message", body: input.body };
  }
}
