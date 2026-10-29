# DUVRI controlled rollout checklist

This checklist is a release gate for the isolated DUVRI document pipeline. A passing CI run proves software checks only; it does not approve the risk method or the document for operational use.

## Required before enabling generation

- [ ] **Risk method approved by Colligo technical owner.** Record the exact method, scale, interpretation of each value, and the treatment of continuation rows. Resolve the source-template discrepancy between probability × severity (1–9) and the separate I.R. values (1–3); do not infer a conversion.
- [ ] **Approval is traceable.** Set `DUVRI_RISK_RULE_APPROVED=true` only after approval exists, and provide `DUVRI_RISK_RULE_DESCRIPTION`, `DUVRI_RISK_RULE_APPROVAL_ID`, and `DUVRI_RISK_RULE_VERSION`.
- [ ] **Controlled Word template selected.** Verify the approved source file, layout, tables, logo/images, normative references, and version. Configure `DUVRI_TEMPLATE_OBJECT_PATH` and `DUVRI_TEMPLATE_VERSION`; keep the source immutable and versioned.
- [ ] **DOCX engine explicitly enabled only for the approved template.** `DUVRI_DOCX_ENGINE_ENABLED=true` is not a substitute for the method/template approvals above.
- [ ] **Synthetic end-to-end dry run passed.** Use non-personal test data and the controlled template. Inspect the generated DOCX in Microsoft Word or a compatible renderer; automated XML checks alone do not prove visual fidelity.
- [ ] **Risk-table mapping verified.** Confirm every source-template row maps exactly once; continuation rows do not receive duplicated scores; no unknown factor is invented; unresolved inputs stop the run.
- [ ] **Signature fields stay blank.** Do not prefill company names in signature/name cells. Preserve signature rows so the parties can sign after delivery.
- [ ] **QA evidence retained.** Review unsupported claims, conflicts, missing information, citations/normative references, and all mandatory human checks.
- [ ] **Human technical review required.** The resulting document remains a draft until an authorized competent reviewer approves it; AI or CI must never mark it technically approved.
- [ ] **Privacy and access verified.** Cloud generation remains disabled by default; use explicit user consent, private storage, least-privilege access, and a documented retention policy.

## Safe default

Until every applicable item above is complete, leave the cloud pipeline and DOCX engine disabled. Jobs must remain blocked/awaiting configuration, and no risk score or operationally usable DUVRI must be emitted.

## Evidence to attach to the release decision

- Risk-method approval reference and version
- Controlled template identifier/version and file hash
- CI run links and synthetic test-case identifier
- DOCX visual-review result and list of deviations (ideally none)
- Reviewer identity/role and approval date
- Confirmation that signature fields remain blank
