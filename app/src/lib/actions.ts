import { getRegion, type Region } from './region';
import type { Story } from './types';

/**
 * Every link the app can show besides the original article.
 * These are fixed, hand-checked official pages. The AI never writes links.
 * Last checked: 26 Sep 2026.
 */
export const TRUSTED_LINKS = {
  // Have I Been Pwned: check if an email appears in known data breaches
  breachCheck: 'https://haveibeenpwned.com/',
  // where to report a scam, by the reader's region:
  //   UK: NCSC guide to reporting scam emails, texts, calls and websites
  //   India: National Cyber Crime Reporting Portal (helpline 1930)
  //   elsewhere: econsumer.gov, the international consumer fraud reporting site (ICPEN, 65+ countries)
  reportScam: {
    GB: 'https://www.ncsc.gov.uk/collection/phishing-scams',
    IN: 'https://cybercrime.gov.in/',
    INTL: 'https://www.econsumer.gov/',
  } as Record<Region, string>,
  // US NIST National Vulnerability Database, one page per CVE ID
  cve: (id: string) => `https://nvd.nist.gov/vuln/detail/${id}`,
  // MITRE ATT&CK: one page per tactic (TA0001) and per technique (T1566, T1566.001)
  tactic: (id: string) => `https://attack.mitre.org/tactics/${id}/`,
  technique: (id: string) => `https://attack.mitre.org/techniques/${id.replace('.', '/')}/`,
};

const TACTIC_FORMAT = /^TA\d{4}$/;
const TECHNIQUE_FORMAT = /^T1\d{3}(\.\d{3})?$/;

/** Link for one attack chain step. Only builds links from checked ID formats. */
export function chainLink(step: { tactic: string; technique?: string }): string | null {
  if (step.technique && TECHNIQUE_FORMAT.test(step.technique)) return TRUSTED_LINKS.technique(step.technique);
  if (TACTIC_FORMAT.test(step.tactic)) return TRUSTED_LINKS.tactic(step.tactic);
  return null;
}

const CVE_FORMAT = /^CVE-\d{4}-\d{4,7}$/;

export type ActionLink = { label: string; url: string; icon: 'shield-check-outline' | 'email-search-outline' | 'flag-outline' };

export function actionFor(story: Story): ActionLink | null {
  const cve = story.cves?.find((c) => CVE_FORMAT.test(c));
  switch (story.action) {
    case 'patch':
      return cve ? { label: `View ${cve}`, url: TRUSTED_LINKS.cve(cve), icon: 'shield-check-outline' } : null;
    case 'check_breach':
      return { label: 'Check if your email was leaked', url: TRUSTED_LINKS.breachCheck, icon: 'email-search-outline' };
    case 'report_scam': {
      const region = getRegion();
      const label = region === 'IN' ? 'Report it: call 1930 or cybercrime.gov.in' : 'How to report a scam';
      return { label, url: TRUSTED_LINKS.reportScam[region], icon: 'flag-outline' };
    }
    default:
      return cve ? { label: `View ${cve}`, url: TRUSTED_LINKS.cve(cve), icon: 'shield-check-outline' } : null;
  }
}
