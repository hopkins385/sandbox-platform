# What This Means for BSI IT-Grundschutz / KRITIS

This is a research-grounded look at what the gaps described in [THREAT_MODEL.md](./THREAT_MODEL.md) and [ARCHITECTURE_REVIEW.md](./ARCHITECTURE_REVIEW.md) actually mean if this platform is deployed inside an organization subject to German critical infrastructure regulation.

## Does KRITIS/BSI even apply?

Only if the deploying organization is a designated KRITIS operator (thresholds are set by the BSI-KritisV, by sector: energy, water, health, finance, transport, IT/telecom, food, municipal waste, state/administration), or, since the NIS2 Implementation Act came into force in December 2025, a broader "important" or "especially important" entity (KRITIS operators continue to count among the "especially important" group).

If that's the case, §8a BSIG obliges "appropriate organizational and technical measures reflecting the state of the art" to protect the confidentiality, integrity, availability, and authenticity of systems. This typically covers supporting internal IT systems too, not just the system that directly delivers the critical service, because a weak internal tool can be a pivot point into the systems that matter.

## Where this platform's current gaps map onto BSI requirements

### Network segmentation (module NET.1.1)
BSI's baseline requires clients and servers to sit in separate security segments, with communication between them controlled by at least one firewall (NET.1.1.A5), and requires *testing* that the segmentation actually works. A flat deployment where "everyone behind one VPN can reach the orchestrator and every sandbox container" does not meet this, even at the normal protection level, regardless of how good the VPN itself is. See [THREAT_MODEL.md](./THREAT_MODEL.md) for why a VPN alone doesn't close this gap.

### Identity and access management (module ORP.4)
The stated goal of this module is that users or IT components can only access the resources they're authorized for. Concretely, it expects:
- A documented authentication concept per system (ORP.4.A12)
- An access-control policy with role-matched rights profiles, not blanket access (ORP.4.A16)
- Secure, cryptographic storage of credentials
- Multi-factor authentication at higher protection levels (ORP.4.A21)

This platform has zero accounts or authorization model today (see "No HTTP API authentication" in [ARCHITECTURE_REVIEW.md](./ARCHITECTURE_REVIEW.md)). Any VPN-connected user can act as any other user and touch any app. This fails the ORP.4 baseline outright, independent of whether the VPN itself has MFA.

### Attack detection (§8a Abs. 1a BSIG)
Since May 2023, KRITIS operators are required to operate attack detection systems, in practice a SIEM with continuous monitoring, typically run through a SOC or MSSP. This platform currently swallows errors silently (`destroyContainer()`), keeps sessions in memory with no audit trail, and has no logging of container network egress or access patterns. Even if something went wrong, there is no way to detect or reconstruct it after the fact.

### Incident reporting duties
BSIG and NIS2 require reporting significant disruptions to the BSI within 24–72 hours, with more detailed follow-up reports afterward. That is only achievable if logging exists to notice the incident in the first place. This platform's current lack of persistence and audit trail makes it structurally unable to meet that timeline today.

## Bottom line

If this platform were deployed inside a company that is a KRITIS operator or otherwise NIS2-covered, sitting behind a VPN would not be sufficient to pass an §8a audit. The gap isn't that a VPN is the wrong control, it's that BSI's framework explicitly expects layered controls: network segmentation *and* per-user authorization *and* monitoring/attack detection. This platform currently has only the perimeter layer. Treat this document, together with [THREAT_MODEL.md](./THREAT_MODEL.md), as the reason this stays a proof of concept rather than something to run inside a regulated environment as-is.

## Sources

- [BSI - KRITIS-Downloads - Konkretisierung der KRITIS-Anforderungen (§ 8a Absatz 1 und Absatz 1a BSIG)](https://www.bsi.bund.de/SharedDocs/Downloads/DE/BSI/KRITIS/Konkretisierung_Anforderungen_Massnahmen_KRITIS.html)
- [KRITIS Ongoing Compliance: Continuous Operator Obligations](https://www.advisori.de/services/regulatory-compliance-management/kritis/kritis-ongoing-compliance)
- [Kritis Regulation: Understanding & Meeting Requirements](https://www.docusnap.com/en/it-documentation/bsi-kritis-regulation-the-german-it-security-act)
- [BSI - Baseline Protection in Information Security](https://www.bsi.bund.de/EN/Themen/Unternehmen-und-Organisationen/Standards-und-Zertifizierung/IT-Grundschutz/it-grundschutz_node.html)
- [BSI IT-Grundschutz 2026: Grundschutz++ & Certification](https://www.orbiqhq.com/eu-regulations/bsi-it-grundschutz)
- [BSI ORP.4 Identitäts- und Berechtigungsmanagement (Edition 2023)](https://www.bsi.bund.de/SharedDocs/Downloads/DE/BSI/Grundschutz/IT-GS-Kompendium_Einzel_PDFs_2023/02_ORP_Organisation_und_Personal/ORP_4_Identitaets_und_Berechtigungsmanagement_Editon_2023.pdf)
