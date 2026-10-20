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
      return notSent('This request is over the included-AI limit', 'Nothing was sent. The estimate includes your chosen model, reasoning and reply length, conversation, prompt and attachment. If history is the issue, retry with recent context or start a fresh chat; if your prompt or attachment is large, edit this saved message and Fork & Send. You can also choose a smaller reply length or another model yourself. The original transcript stays unchanged; Flowmate will not rewrite or downgrade your request.', ['recent_context', 'new_chat', 'settings']);
    case 'BRIEFING_COST_ENVELOPE_EXHAUSTED':
      return notSent('This briefing is over the included-AI limit', 'Nothing was sent and your existing briefing and workspace are unchanged. This is a request-size limit, not a daily allowance. Review unusually long task or event titles, or use your own Gemini key in Settings; retrying unchanged workspace data will not help.', ['settings']);
    case 'TURN_COST_ENVELOPE_EXHAUSTED':
      return notSent('This turn reached its managed limit', 'This additional model step was not sent. A new message starts a new turn; if the same long history is still included, retry this message with only recent context or start a fresh conversation. Your transcript remains unchanged.', ['recent_context', 'new_chat', 'settings']);
    case 'TURN_GENERATION_LIMIT':
      return notSent('This turn reached its managed limit', 'Flowmate stopped before sending another model step. Your workspace was not changed by this blocked step. Continue with a new message, or retry this saved request with recent context if this conversation is long.', ['recent_context', 'new_chat']);
    case 'USER_MANAGED_BUDGET_EXHAUSTED':
      return notSent('Your monthly managed-AI budget is used', `It resets ${formatManagedAiResetAt('month', now)}. This is an account-level safety limit and cannot be cleared by shortening this message; your own Gemini key remains available.`);
    case 'MANAGED_AI_BUDGET_TEMPORARILY_UNAVAILABLE':
      return notSent('Flowmate’s included AI is at its monthly safety limit', `This is a service-side limit and cannot be cleared by changing your message. It resets ${formatManagedAiResetAt('month', now)}; your workspace is unchanged. You can use your own Gemini key in Settings meanwhile.`, ['settings']);
    case 'MANAGED_AI_BUDGET_UNAVAILABLE':
      return notSent('Flowmate could not verify its safety controls', 'No managed generation was started. This needs a server-side recovery; your workspace and message are preserved. Try later or use your own Gemini key.');
    case 'MODEL_CONTEXT_LIMIT':
      return notSent('The selected model’s context is full', 'Nothing was sent. Retry with recent context or start a fresh chat. If the prompt or attachment is large, edit this saved message to trim it or remove the attachment, then Fork & Send. You may also choose an available model with a larger context. These choices keep the original transcript; Flowmate will not silently rewrite it. If even a short new chat fails, this needs an application-side context fix; your account is not blocked.', ['recent_context', 'new_chat', 'settings']);
    case 'OUTPUT_TOKEN_LIMIT':
      return notSent('The reply length is above this model’s limit', 'Nothing was sent. Choose a shorter reply length or a model that supports the selected limit, then retry this saved request. Flowmate will not silently shorten the reply.');
    case 'MODEL_NOT_ALLOWED_FOR_ACCOUNT':
      return notSent('This model needs different access', 'Nothing was sent. Choose a model listed for your current account, or use your own Gemini key in Settings. Signing in does not grant privileged access automatically.', ['settings']);
    case 'MODEL_UNAVAILABLE':
      return notSent('This model is unavailable right now', 'Nothing was sent. Choose another model currently listed in the model picker, or retry later. Flowmate did not switch models automatically.');
    case 'MODEL_TOOL_CALLING_UNAVAILABLE':
      return notSent('This model cannot perform workspace actions', 'Nothing was sent. Choose a model marked for tool use, or ask for an explanation without workspace actions. No workspace changes were made.');
    case 'UNSUPPORTED_REASONING_LEVEL':
      return notSent('This reasoning level is unavailable for the model', 'Nothing was sent. Choose one of the reasoning levels offered for the selected model, then retry.');
    case 'MODEL_INPUT_UNSUPPORTED':
      return notSent('This model cannot read the selected input', 'Nothing was sent. Remove the unsupported attachment or input, or choose a compatible model. Your original message remains saved.');
    case 'PROVIDER_RATE_LIMITED':
      return notSent('Google is temporarily limiting this model', 'Wait briefly, then retry this saved message. Flowmate will not switch providers or models automatically.', []);
    case 'REQUEST_ALREADY_PROCESSED':
      return notSent('This request was already submitted', 'Check this conversation for a completed reply before sending again. Flowmate will not repeat it automatically. If no reply appears, wait for the request status to settle, then retry deliberately.', []);
    case 'TURN_ALREADY_COMPLETE':
      return notSent('This chat turn is already complete', 'Check the existing reply in this conversation. Send a new message if you want another answer; this completed turn will not be replayed.', []);
    case 'INVALID_REQUEST':
      return notSent('Flowmate could not validate this request', 'Nothing was sent. Review the message, selected model, reply settings and attachments, then edit and retry. If this keeps happening with a normal request, it needs an application-side fix.', []);
    case 'RATE_LIMITED':
    case 'USER_CALL_IN_PROGRESS':
      return notSent('Another request needs to finish first', 'Wait for the current request to finish, then retry this saved message. Flowmate did not automatically resubmit it.', []);
    case 'APP_CHECK_REQUIRED':
      return notSent('Flowmate could not verify this app session', 'No managed generation was started. Reload the official Flowmate page, then retry. If it continues, this needs an application-side App Check fix; do not change security settings to work around it.', ['reload']);
    case 'AUTH_REQUIRED':
    case 'EMAIL_VERIFICATION_REQUIRED':
      return notSent('Flowmate could not verify this account', 'No managed generation was started. Sign in; if needed, verify your email, reload Flowmate, then retry.', ['sign_in', 'reload']);
    case 'MANAGED_AI_DISABLED':
      return notSent('Managed AI is temporarily unavailable', 'This needs an owner-side service change; your message and workspace are preserved. You can use your own Gemini key in Settings.');
    case 'MANAGED_AI_NOT_CONFIGURED':
    case 'MANAGED_AI_UNAVAILABLE':
      return notSent('Managed AI is not ready here', 'This needs an application-side configuration or service recovery. Your workspace is still available; you can use your own Gemini key in Settings or try again later.');
    case 'MODEL_CATALOG_UNAVAILABLE':
    case 'PRICING_POLICY_UNAVAILABLE':
      return notSent('Flowmate could not verify this request', 'No managed generation was started because model limits or current pricing could not be confirmed. This needs a server-side fix; retry later or use your own Gemini key.');
    default:
      return notSent('No AI response was received', 'Your message is saved and your workspace is unchanged. Review the request, then retry when ready or use your own Gemini key.');
  }
}
