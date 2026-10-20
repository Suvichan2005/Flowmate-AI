import { formatManagedAiResetAt } from './managedAiLimitCopy';

export interface ManagedRequestGuidance {
  outcome: 'not_sent' | 'uncertain';
  title: string;
  description: string;
  actions: Array<'new_chat' | 'recent_context' | 'settings' | 'sign_in' | 'reload'>;
}

export function getManagedRequestGuidance(code: string, outcome: 'not_sent' | 'uncertain', now = new Date()): ManagedRequestGuidance {
  const notSent = (title: string, description: string, actions: ManagedRequestGuidance['actions'] = ['settings']): ManagedRequestGuidance => ({ outcome: 'not_sent', title, description, actions });
  const uncertain = (description: string): ManagedRequestGuidance => ({ outcome: 'uncertain', title: 'Result not confirmed', description, actions: [] });

  if (outcome === 'uncertain' || code === 'GENERATION_FAILED') {
    return uncertain('Flowmate could not confirm the result. Gemini may have received this request, so its cost hold stays until reconciled and Flowmate will not retry it automatically. You can continue chatting; this attempt is excluded from later AI context. Check for a reply before sending it again to avoid duplicate work.');
  }
  switch (code) {
    case 'GUEST_TURN_ALLOWANCE_EXHAUSTED':
      return notSent('Monthly guest turns used', `Your 30 guest turns reset ${formatManagedAiResetAt('month', now)}. Sign in for the account allowance or add your own Gemini key.`, ['sign_in', 'settings']);
    case 'TURN_ALLOWANCE_EXHAUSTED':
      return notSent('Monthly Chat allowance used', `Your 150 included turns reset ${formatManagedAiResetAt('month', now)}. You can use your own Gemini key meanwhile.`);
    case 'REQUEST_COST_ENVELOPE_EXHAUSTED':
    case 'BRIEFING_COST_ENVELOPE_EXHAUSTED':
      return { ...notSent('This request is over the included-AI limit', 'Nothing was sent. This check includes your selected model, reply settings, conversation and current prompt. If older history is driving it, retry with recent context or start a fresh chat. If the prompt or attachment is large, use the pencil on this saved message to trim it or remove the attachment, then Fork & Send. Your transcript stays unchanged; Flowmate never rewrites your request.', ['recent_context', 'new_chat', 'settings']) };
    case 'TURN_COST_ENVELOPE_EXHAUSTED':
      return { ...notSent('This turn reached its managed limit', 'This additional model step was not sent. A new message starts a new turn; if the same long history is still included, retry this message with only the most recent 12 messages or start a fresh conversation. Your transcript remains unchanged.', ['recent_context', 'new_chat', 'settings']) };
    case 'USER_MANAGED_BUDGET_EXHAUSTED':
      return notSent('Your monthly managed-AI budget is used', `It resets ${formatManagedAiResetAt('month', now)}. This is an account-level safety limit and cannot be cleared by shortening this message; your own Gemini key remains available.`);
    case 'MANAGED_AI_BUDGET_TEMPORARILY_UNAVAILABLE':
      return notSent('Flowmate’s included AI is at its monthly safety limit', `This is a service-side limit and cannot be cleared by changing your message. It resets ${formatManagedAiResetAt('month', now)}; your workspace is unchanged.`, []);
    case 'MANAGED_AI_BUDGET_UNAVAILABLE':
      return notSent('Flowmate could not verify its safety controls', 'No managed generation was started. This needs a server-side recovery; your workspace and message are preserved. Try later or use your own Gemini key.');
    case 'MODEL_CONTEXT_LIMIT':
      return { ...notSent('The selected model’s context is full', 'Nothing was sent. Retry with the most recent 12 conversation messages or start a fresh chat. If the current prompt or attachment is the cause, use the pencil on this saved message to trim it or remove the attachment, then Fork & Send. These actions keep the original transcript. If the shorter request still fails, Flowmate needs an application-side context fix; your account is not blocked.', ['recent_context', 'new_chat', 'settings']) };
    case 'RATE_LIMITED':
    case 'USER_CALL_IN_PROGRESS':
      return notSent('Another request needs to finish first', 'Wait for the current request to finish, then retry this saved message. Flowmate did not automatically resubmit it.');
    case 'APP_CHECK_REQUIRED':
      return notSent('Flowmate could not verify this app session', 'No managed generation was started. Reload the official Flowmate page, then retry. If it continues, this needs an application-side App Check fix; do not change security settings to work around it.', ['reload']);
    case 'AUTH_REQUIRED':
    case 'EMAIL_VERIFICATION_REQUIRED':
      return notSent('Flowmate could not verify this account', 'No managed generation was started. Sign in; if needed, verify your email, reload Flowmate, then retry.', ['sign_in', 'reload']);
    case 'MANAGED_AI_DISABLED':
      return notSent('Managed AI is temporarily unavailable', 'This needs an owner-side service change; your message and workspace are preserved. You can use your own Gemini key in Settings.');
    case 'MODEL_CATALOG_UNAVAILABLE':
    case 'PRICING_POLICY_UNAVAILABLE':
      return notSent('Flowmate could not verify this request', 'No managed generation was started because model limits or current pricing could not be confirmed. This needs a server-side fix; retry later or use your own Gemini key.');
    default:
      return notSent('No AI response was received', 'Your message is saved and your workspace is unchanged. Review the request, then retry when ready or use your own Gemini key.');
  }
}
