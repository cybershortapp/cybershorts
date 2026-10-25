import type { PoolGame } from './extras';
import type { Story } from './types';

/**
 * Games that are always ready (built in, no server needed): the same everyday lessons whatever the news.
 * Shown in the Play section, and inside an attack chain when that story has no game of its own.
 * Made-up names only.
 */
export const READY: PoolGame[] = [
  { id: 'ready-home', story_id: '', style: 'home', headline: 'Your own digital life', data: { rounds: [
    { spot: 'email', kind: 'reused', say: 'I found your password in an old data leak. Bet you use the same one for email!', fail: 'Email hacked. He reset your other passwords from it.' },
    { spot: 'bank', kind: 'stolen', say: 'You typed your bank password into my fake site. Logging in now!', fail: 'Bank hacked. £2,000 gone to a "safe account".' },
    { spot: 'router', kind: 'default', say: 'Your Wi-Fi router still uses the password on its sticker!', fail: 'Router hacked. He can see everything on your Wi-Fi.' },
    { spot: 'phone', kind: 'old_bug', say: "Your phone hasn't updated in a year. I know an old bug that gets me in.", fail: 'Phone hacked. He can read your messages.' },
    { spot: 'social', kind: 'stolen', say: 'I bought your social media password online. Time to message your friends!', fail: 'Your friends got scam messages from "you".' },
  ] } },
  { id: 'ready-approve', story_id: '', style: 'approve', headline: 'A real trick used on big companies', data: {
    place: 'Rotterdam, Netherlands',
    real: [{ app: 'MESSAGES', title: 'Mum', body: 'Are you still coming for dinner tonight?' }, { app: 'BANK', title: 'Card payment', body: '£4.20 at the coffee shop' }, { app: 'CALENDAR', title: 'Team meeting', body: 'Starts in 10 minutes' }],
    call: { name: 'Marek from IT', say: "Sorry about all the alerts, there's a glitch on your account. You'll get one more prompt. Just tap Approve and they'll all stop." },
  } },
  { id: 'ready-crack', story_id: '', style: 'crack_meter', headline: 'Make a password nobody can crack', data: { words: ['Teapot', 'Purple', 'Rocket', 'Pickle', 'Lantern', 'Otter', 'Glacier', '42'] } },
];

const byId = (id: string) => READY.find((g) => g.id === id)!;

/** The everyday game that fits a story best: sign-in prompts, passwords, or locking up your accounts. */
export function readyFor(story: Story): PoolGame {
  const text = `${story.headline} ${story.technical ?? ''}`.toLowerCase();
  const stages = (story.attack_chain ?? []).map((s) => s.stage);
  if (/\b(mfa|2fa|multi-factor|two-factor|push notification|prompt bomb|mfa fatigue|sign-in prompt|authenticator)\b/.test(text)) return byId('ready-approve');
  if (/\b(password|brute.?force|credential stuffing|cracked)\b/.test(text) || stages.includes('Credential Access')) return byId('ready-crack');
  return byId('ready-home');
}
