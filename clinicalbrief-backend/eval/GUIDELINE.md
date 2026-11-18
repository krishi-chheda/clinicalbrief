# Labelling guideline: note extraction

Written before labelling and before looking at the pipeline's output on these notes. Labels describe the note, not
what the extractor can find: a mention the extractor's vocabulary does not contain is still labelled.

## What a label is

One JSON object per distinct mention in a note:

```json
{"text": "type 2 diabetes mellitus", "type": "Disease", "negated": false, "subject": "patient"}
```

- **text**: the term as written in the note, lower case, without Synthea's semantic tag ("hypertension (disorder)"
  is labelled `hypertension`). For medications, the whole product string as written
  (`lisinopril 10 mg oral tablet`). One label per distinct term per note, however often it appears.
- **type**: one of `Disease`, `Symptom`, `Medication`, `Procedure`, `Allergy`.
- **negated**: `true` when the note says the patient does not have it ("no fever", "denies chest pain").
- **subject**: `patient`, or `family` when it is about a relative ("mother had breast cancer").

Only affirmed patient mentions (`negated: false`, `subject: patient`) are targets. Negated and family mentions are
labelled so that outputting them counts as a negation / family-history error.

## Types

| Type | Include | Examples |
|---|---|---|
| Disease | Every `(disorder)`; `(finding)`s that name a condition of the body; diagnoses in prose | hypertension, prediabetes, obesity, gingivitis, chronic pain, anemia |
| Symptom | Symptoms and signs the patient has (chief complaint items, "presenting with" symptoms) | fatigue, thirst, cough, wheezing |
| Medication | Each drug product mentioned (medication lists, prescriptions) | lisinopril 10 mg oral tablet |
| Procedure | Each `(procedure)` and named procedure in prose, including screenings and assessments | depression screening, medication reconciliation |
| Allergy | Each substance the patient is allergic to | penicillin, peanut |

Uncertain or hypothetical mentions ("rule out pneumonia", "return if fever develops", "hypertension suspected") are
not affirmed findings: they are labelled `negated: true`. (Added 2026-11-13 for the negation set; no Synthea note in
the first set contains such a mention, so its labels are unchanged.)

Past history counts: "Patient has a history of asthma" is an affirmed patient mention of asthma.

## Excluded (not labelled)

- Social and administrative circumstances, even when tagged `(finding)` / `(situation)`: employment, education,
  income, housing, insurance, marital status, social contact or isolation, stress, abuse or violence, criminal record,
  "medication review due", smoking and alcohol history.
- Immunizations and lab tests / questionnaires ("The following lab reports were completed"): not in the five types.
- Generic phrases with no specific term: "No Known Allergies", "No complaints".
- Demographics (age, gender, ethnicity, names).

## Who labelled

`labelled_by` and `reviewed_by` in every gold file say who. Labels drafted by an AI model are published as
"AI-drafted" until a person has reviewed them; `reviewed_by` then names that person.
