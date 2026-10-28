# Skill: duvri-colligo

Version: 0.1.0  
Status: specification/prototype design — not yet connected to the SafetyChecklist runtime.

## Mission

Prepare a reviewable draft of a Colligo DUVRI by collecting job-specific information, inspecting supplied source documents, and filling the approved original Word template. Preserve the template's formatting and distinguish facts, extracted statements, assumptions, missing data, and proposed controls.

This skill does not approve a DUVRI, certify legal compliance, or replace a competent safety professional.

## Inputs

- Structured intake record defined in `schemas/duvri-intake.schema.json`.
- Original approved DOCX template: `DUVRI_BASE_GENERALE_2026.docx` (maintain as a versioned controlled asset; it is currently supplied by the user and is not yet stored in this repository).
- Job-specific files supplied by authorized users: DVR, cronoprogramma, plans, site/emergency information, procedures, equipment lists, safety data sheets where relevant, prior DUVRI examples, permits and other applicable attachments.
- Approved Colligo instructions for risk scoring, table colors, document typography, page layout, and normative references.

## Required operating sequence

1. **Create a new job**. Generate a unique job identifier and bind all uploaded files and answers to that job. Do not reuse client data from other jobs.
2. **Collect common data**. Capture client and contractor details, site, title, dates, scope, responsible contacts and each contractor's preposto (name, role/area of competence). Permit multiple contractors and subcontractors.
3. **Classify the activity provisionally**. Identify site context and potential modules from user answers and documents. Classification guides questions; it is not a risk assessment.
4. **Collect task phases**. For each contractor, capture activity, sequence, location, planned dates/times, duration, personnel, dependencies, concurrent work and interfaces with client operations or third parties.
5. **Collect site and access data**. Ask about work area, routes, access controls, vehicle movements, storage, barriers, public/other workers, emergency routes, utilities and operating plant where applicable.
6. **Collect equipment and PPE**. For every machine/tool/vehicle capture description, user company, owner, intended use, operating area and supporting documents. Capture PPE supplied/required according to the contractor's documentation and activity; do not infer unsupported specifications.
7. **Register source documents**. For each file store title, issuing party, date/version if available, received/missing/not applicable status, extracted facts and the page/section supporting important claims. If extraction is uncertain, mark for manual verification.
8. **Ask conditional follow-up questions**. Use the rules below. Avoid asking questions already answered by reliable source documents; show the extracted value and ask the user to confirm when ambiguity or safety significance warrants it.
9. **Run completeness and consistency checks**. Compare answers with documents and across contractors, phases, schedules, locations and equipment. Identify contradictions, missing facts, unverified claims and relevant documents not supplied.
10. **Prepare draft content**. Populate only supported fields in the original template. Use the approved Colligo text and risk methodology; do not invent details or silently rewrite fixed legal/technical boilerplate.
11. **Validate output**. Check for remaining placeholders, correct client/company names, singular/plural language, section sequence, tables, image presence, landscape sections, headers/footers, page numbers and index. Produce a separate validation report.
12. **Human review**. Mark output as "BOZZA — DA REVISIONARE". Do not sign, approve or issue it automatically. Require review by authorized competent personnel before official use.

## Conditional question modules

Activate a module when user answers or source material indicate it may apply. If relevance is unclear, ask a concise screening question first.

### Multiple contractors / subcontractors
- Create a separate contractor record for every company.
- Ask legal name, role, scope, contact, preposto, personnel, work phases, equipment, PPE and documents for each.
- Ask whether each subcontractor is authorized and which tasks it performs; flag missing confirmation.
- Build a timeline of phase overlap and shared areas.

### Work at height / roof access
- Ask work location/height and access method; fall prevention/protection measures; collective protections; areas below; falling-object controls; rescue/emergency arrangements; equipment and relevant inspection documents.
- Do not assume a specific method or protection is present unless confirmed in source data.

### Confined or potentially polluted spaces
- Ask whether the space meets the company's applicable definition/assessment, task and access points, isolation/lockout, permits, competent persons, atmospheric monitoring, ventilation, communications, attendant/supervision, retrieval and emergency/rescue procedures, equipment and related training/fitness documents where applicable.
- Treat the module as a completeness prompt, not a certification of compliance. Escalate uncertain or missing critical information to a competent reviewer.

### Electrical systems / energy sources
- Ask equipment/system affected, operational status, isolation and authorization arrangements, interfaces with client systems, competent operators, verification and restart responsibilities. Do not assume an installation is de-energized.

### Chemicals / substances
- Ask product name, use, location, quantity or duration if relevant, SDS availability, storage, spills, incompatible activities and exposure to other workers. Request SDS when relevant and missing.

### Vehicles, lifting equipment and machinery
- Ask machine type, owner, user company, route, manoeuvres, loading/unloading, lifting zones, operators, inspection/maintenance evidence where applicable, pedestrian/public interface and segregation arrangements.

### Hot works / dust / fumes / noise / vibration
- Ask whether generated by the task, where/when, other exposed people, permits or authorizations, containment/ventilation, fire prevention, monitoring or restrictions, and supporting procedures as applicable.

### Public areas / retail / occupied premises
- Ask opening hours, public/customer presence, separation of work area, emergency exits, deliveries, cleaning/maintenance, noise/dust restrictions, and who can authorize access or suspension.

### Excavation / underground services / outdoor work
- Ask excavation dimensions and location if applicable, underground services information, barriers, traffic, weather exposure, ground stability, access, storage, adjacent operations and permits/documents.

### Emergency arrangements
- Ask site emergency plan/instructions, emergency contacts, assembly point, first aid/fire response, access for rescuers, and whether the work temporarily affects exits, alarms, extinguishers or emergency routes.

## Evidence and uncertainty rules

- Treat the user-provided answers and files as job-specific evidence, not as globally reusable defaults.
- For important extracted facts, retain source filename and page/section where possible.
- If sources conflict, do not choose silently. List both values and ask for resolution or mark for reviewer decision.
- Use explicit statuses: `confirmed`, `extracted_unconfirmed`, `missing`, `not_applicable`, `conflicting`, `requires_professional_review`.
- Never infer a missing company name, preposto, date, work method, ownership, protection measure, emergency procedure or risk score.
- Do not copy names, dates, site information, equipment or risk controls from a previous DUVRI into a new job.
- Keep risks and measures specific to interference between parties/activities in the shared workplace; do not substitute this with an unsupported assessment of each company's intrinsic risks.
- Normative references must be checked against an approved, current reference source and flagged with the verification date/source. If the check cannot be completed, state "riferimento da verificare".
- Risk scoring must use the approved Colligo method and its defined criteria. Do not convert values or colors from one scale to another without an explicitly approved mapping.

## Word-template preservation contract

The source template has 434 paragraphs, 13 tables and 19 Word sections, including portrait and landscape sections. These counts are baseline checks, not an assertion that every generated document must retain the same counts if an authorized change is required.

- Edit a copy of the original DOCX, never overwrite the controlled source template.
- Preserve page/section breaks, orientation, margins, styles, fonts, header/footer content, logos, decorative artwork, tables, cell fills, images and table layout unless a specific authorized field or approved requirement changes them.
- Replace placeholders at run-level where feasible to avoid destroying formatting. Avoid whole-document text replacement that collapses Word runs or strips highlights/styles.
- Keep the "TABELLA INDICI DI RISCHIO" immediately after "Valutazione dell’indice di rischio" as specified by the approved template.
- Preserve all risk rows in the final assessment tables. If a row is not applicable or evidence is insufficient, follow the approved Colligo scoring procedure; do not remove the row or invent a value.
- Add the supplied `segnaletica.png` at the end of section 2.3 only after the correct source image is available, without adding a border.
- Use Arial 12 for chapter titles, Arial 11 for subchapter titles, Arial 10 for body text, 1.5 line spacing, justified paragraphs, and the requested portrait/landscape margins only after confirming these settings against the controlled source and avoiding unintended changes to fixed layout.
- The request describes both a 1–9 risk matrix and final "I.R." cells with values 1–3. This is an unresolved policy conflict. Do not implement scoring/color changes until Colligo confirms the official rule.
- Page numbering and table of contents must be refreshed using a compatible document renderer and visually checked. If reliable refresh is unavailable, flag it rather than claiming it is correct.

## Output package

1. Draft DOCX based on the approved template.
2. Separate validation report listing missing information, conflicts, assumptions avoided, normative references checked/unverified, and human-review decisions.
3. Job metadata: template version, skill version, source file list, generation timestamp, status and reviewer.
4. Optional PDF preview only after the DOCX has passed layout validation.

## Minimum acceptance tests

- One contractor; one subcontractor; multiple contractors.
- Missing preposto, missing schedule, missing plan, unavailable logo and missing date.
- A confined-space task triggers its module; a routine non-confined task does not receive confined-space boilerplate.
- Conflicting dates or contractor descriptions in intake versus attachments are flagged.
- Source template remains unchanged after generation.
- Portrait and landscape sections, images, tables, headers/footers and signature table survive round-trip.
- No unresolved placeholder is silently replaced with invented content.
- Risk scoring cannot run if the approved scale/mapping is not configured.
- A closed browser or powered-off client device does not cancel a queued cloud job (tested once backend job processing exists).
- Unauthorized users cannot access jobs or generated files.
