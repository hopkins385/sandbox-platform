# Deployment Threat Model: Is a VPN Enough?

The recommended mitigation for the auth gaps in [ARCHITECTURE_REVIEW.md](./ARCHITECTURE_REVIEW.md) is to deploy this behind a VPN or other trusted, isolated network. That helps, but it only closes one part of the attack surface. Two attacker classes to consider separately:

## Opportunistic / internet-scanning attackers

A VPN is genuinely effective here. With no port exposed to the public internet, there is nothing for automated scanners, bots, or opportunistic attackers to find or hit. This removes a large share of realistic risk for a proof of concept.

## Targeted attackers or a compromised credential

A VPN does not help here, because it only gates the front door and there is no defense in depth behind it:

- **Zero friction once inside.** There is no per-user authentication (see "No HTTP API authentication" in the architecture review), so anyone on the VPN, or anyone who steals a VPN credential via phishing, a compromised laptop, or a VPN software vulnerability, has the same unrestricted access as every legitimate user: every app, every session, every container.
- **No per-app isolation for users.** Because there are no accounts, one compromised or malicious VPN user can read, edit, or sabotage any other user's app. This is an insider-risk problem as much as an external one: legitimate VPN access is not the same as being trustworthy.
- **Egress is not addressed by a VPN.** A VPN controls who can reach the orchestrator inbound; it does nothing to restrict what a sandbox container can reach outbound. Claude Code running inside a container can still install arbitrary npm/pip packages and make arbitrary outbound network calls. A compromised or careless agent run can exfiltrate the `ANTHROPIC_API_KEY` (see "ANTHROPIC_API_KEY inside sandbox containers" in the architecture review) or other data to the public internet unless container egress is separately firewalled.

## Bottom line

Treat "behind a VPN" as answering the question "can a random attacker on the internet find and hit this?" (mostly yes, closed off), not the question "what happens if one attacker or credential gets in?" (everything is exposed: all apps, all data, the API key). A VPN buys time for a small trusted pilot; it is not a substitute for per-user auth, per-app isolation, and container egress restrictions.

If this platform is ever deployed inside an organization subject to German critical infrastructure regulation, these same gaps have concrete regulatory weight, not just security weight. See [COMPLIANCE_KRITIS.md](./COMPLIANCE_KRITIS.md) for how they map onto BSI IT-Grundschutz and §8a BSIG (KRITIS) requirements.
